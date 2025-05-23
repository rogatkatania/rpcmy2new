const express = require('express');
const axios = require('axios');
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const cors = require('cors');

// Попытка импорта ethers с обработкой ошибок
let ethers = null;
try {
  ethers = require('ethers');
  console.log('Ethers успешно импортирован, версия:', ethers.version || 'неизвестна');
} catch (error) {
  console.error('Ошибка при импорте ethers:', error.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для обработки JSON-запросов - должен быть в начале!
app.use(express.json());

// Добавляем CORS middleware для всех запросов
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Загружаем алиасы chain_id из JSON-файла
let chainIdAliasesMap = new Map();
let chainIdToAliasesMap = {};

try {
  console.log('Загрузка алиасов chain_id из файла...');
  const aliasesPath = './chain_id_aliases.json';
  
  if (fs.existsSync(aliasesPath)) {
    const aliasesContent = fs.readFileSync(aliasesPath, 'utf8');
    const aliasesData = JSON.parse(aliasesContent);
    
    // Создаем обратное сопоставление: алиас -> chain_id
    Object.keys(aliasesData).forEach(chainId => {
      // Сохраняем сопоставление chain_id -> список алиасов
      chainIdToAliasesMap[chainId] = aliasesData[chainId];
      
      // Создаем сопоставление алиас -> chain_id для быстрого поиска
      aliasesData[chainId].forEach(alias => {
        chainIdAliasesMap.set(alias.toLowerCase(), chainId);
      });
    });
    
    console.log(`Загружено ${chainIdAliasesMap.size} алиасов для ${Object.keys(aliasesData).length} chain_id`);
  } else {
    console.log('Файл с алиасами не найден, создаем новый');
    
    // Создаем базовый набор алиасов
    const basicAliases = {
      "1": ["ethereum", "eth", "mainnet"],
      "56": ["binance", "bsc", "bnb"],
      "137": ["polygon", "matic"],
      "42161": ["arbitrum", "arb"],
      "10": ["optimism", "op"],
      "8453": ["base"],
      "43114": ["avalanche", "avax"]
    };
    
    // Сохраняем базовый набор в файл
    fs.writeFileSync(aliasesPath, JSON.stringify(basicAliases, null, 2), 'utf8');
    
    // Заполняем карту алиасов
    Object.keys(basicAliases).forEach(chainId => {
      // Сохраняем сопоставление chain_id -> список алиасов
      chainIdToAliasesMap[chainId] = basicAliases[chainId];
      
      // Создаем сопоставление алиас -> chain_id для быстрого поиска
      basicAliases[chainId].forEach(alias => {
        chainIdAliasesMap.set(alias.toLowerCase(), chainId);
      });
    });
    
    console.log(`Создан базовый набор из ${chainIdAliasesMap.size} алиасов для ${Object.keys(basicAliases).length} chain_id`);
  }
} catch (err) {
  console.error('Ошибка при загрузке алиасов chain_id:', err.message);
  // Создаем пустые структуры в случае ошибки
  chainIdAliasesMap = new Map();
  chainIdToAliasesMap = {};
}

// Функция для нормализации chain_id (поддержка алиасов)
function normalizeChainId(chainId) {
  if (!chainId) return null;
  
  // Приводим к строке и нижнему регистру для алиасов
  const chainIdStr = String(chainId).toLowerCase();
  
  // Проверяем, есть ли алиас в карте
  if (chainIdAliasesMap.has(chainIdStr)) {
    const normalizedId = chainIdAliasesMap.get(chainIdStr);
    console.log(`Алиас ${chainIdStr} преобразован в chain_id=${normalizedId}`);
    return normalizedId;
  }
  
  // Если это не алиас, возвращаем как есть
  return chainIdStr;
}

// Загружаем список приоритетных RPC-узлов
let priorityRpcList = {};
try {
  // Загружаем приоритетные RPC из файла
  if (fs.existsSync('./priority_rpcs.json')) {
    const priorityRpcContent = fs.readFileSync('./priority_rpcs.json', 'utf8');
    priorityRpcList = JSON.parse(priorityRpcContent);
    console.log('Загружен список приоритетных RPC');
  } else {
    console.log('Файл с приоритетными RPC не найден, создаем новый');
    
    // Сохраняем приоритетные RPC из предоставленного списка
    try {
      if (fs.existsSync('pasted_content.txt')) {
        const priorityRpcData = fs.readFileSync('pasted_content.txt', 'utf8');
        priorityRpcList = JSON.parse(priorityRpcData);
        fs.writeFileSync('./priority_rpcs.json', JSON.stringify(priorityRpcList, null, 2), 'utf8');
        console.log('Создан новый файл с приоритетными RPC');
      } else {
        console.log('Файл pasted_content.txt не найден, создаем пустой список приоритетных RPC');
        fs.writeFileSync('./priority_rpcs.json', JSON.stringify({}, null, 2), 'utf8');
      }
    } catch (priorityErr) {
      console.error('Ошибка при создании файла с приоритетными RPC:', priorityErr.message);
    }
  }
} catch (err) {
  console.error('Ошибка при загрузке приоритетных RPC:', err.message);
  priorityRpcList = {};
}

// Загружаем список RPC-узлов из JSON-файла или из переменной окружения
let rpcList = {};
try {
  // Пробуем загрузить из файла
  if (fs.existsSync('./rpcs.json')) {
    rpcList = JSON.parse(fs.readFileSync('./rpcs.json', 'utf8'));
    console.log('Загружен основной список RPC из файла');
  } else if (process.env.RPC_LIST) {
    try {
      rpcList = JSON.parse(process.env.RPC_LIST);
      console.log('Загружен основной список RPC из переменной окружения');
    } catch (parseErr) {
      console.error('Ошибка парсинга RPC_LIST:', parseErr.message);
    }
  } else {
    console.log('Не удалось загрузить список RPC из локальных источников. Будет использован только приоритетный список.');
  }
} catch (err) {
  console.error('Ошибка при загрузке основного списка RPC:', err.message);
}

// Объединяем приоритетные RPC с основным списком
function mergeRpcLists() {
  console.log('Объединение списков RPC...');
  
  // Создаем копию основного списка
  const mergedList = JSON.parse(JSON.stringify(rpcList));
  
  // Добавляем приоритетные RPC в начало списков для каждого chain_id
  Object.keys(priorityRpcList).forEach(chainId => {
    if (!mergedList[chainId]) {
      mergedList[chainId] = [];
    }
    
    // Добавляем приоритетные RPC, избегая дубликатов
    priorityRpcList[chainId].forEach(rpc => {
      // Удаляем RPC из основного списка, если он там есть
      const index = mergedList[chainId].indexOf(rpc);
      if (index !== -1) {
        mergedList[chainId].splice(index, 1);
      }
    });
    
    // Добавляем приоритетные RPC в начало списка
    mergedList[chainId] = [...priorityRpcList[chainId], ...mergedList[chainId]];
  });
  
  console.log(`Объединенный список содержит ${Object.keys(mergedList).length} chain_id`);
  return mergedList;
}

// Кэш для хранения нерабочих RPC с временем их последней проверки
const failedRpcs = new Map();
// Кэш для хранения результатов проверки методов RPC
const rpcMethodsSupport = new Map();
// Кэш для хранения курсов валют
const currencyRates = new Map();
// Кэш для хранения цен газа
const gasPrices = new Map();

const RETRY_TIMEOUT = parseInt(process.env.RETRY_TIMEOUT) || 5 * 60 * 1000; // 5 минут до повторной проверки
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 15 * 60 * 1000; // Интервал проверки всех RPC (15 минут)
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT) || 5000; // Таймаут запроса (5 секунд)
const CURRENCY_CACHE_TIMEOUT = parseInt(process.env.CURRENCY_CACHE_TIMEOUT) || 5 * 60 * 1000; // 5 минут кэширования курсов
const GAS_PRICE_CACHE_TIMEOUT = parseInt(process.env.GAS_PRICE_CACHE_TIMEOUT) || 1 * 60 * 1000; // 1 минута кэширования цен газа

// Функция для загрузки данных RPC из внешних источников
async function loadRpcDataFromExternalSources() {
  try {
    console.log('Загрузка RPC данных из внешних источников...');
    
    // Загрузка данных из chainlist.org
    try {
      const chainlistResponse = await axios.get('https://chainlist.org/rpcs.json', { timeout: 10000 });
      const chainlistData = chainlistResponse.data;
      
      // Обработка данных из chainlist.org
      if (chainlistData && typeof chainlistData === 'object') {
        Object.keys(chainlistData).forEach(chainId => {
          if (!rpcList[chainId]) {
            rpcList[chainId] = [];
          }
          
          // Проверяем, что chainlistData[chainId] - это массив
          if (Array.isArray(chainlistData[chainId])) {
            // Добавляем новые RPC, избегая дубликатов
            chainlistData[chainId].forEach(rpc => {
              if (!rpcList[chainId].includes(rpc)) {
                rpcList[chainId].push(rpc);
              }
            });
          }
        });
        console.log('Данные из chainlist.org успешно загружены');
      }
    } catch (chainlistError) {
      console.error('Ошибка при загрузке данных из chainlist.org:', chainlistError.message);
    }
    
    // Получаем список всех chain ID из текущего списка для загрузки данных из ethereum-lists/chains
    const chainIds = new Set([...Object.keys(rpcList), ...Object.keys(priorityRpcList)]);
    
    // Добавляем популярные сети, если их нет в списке
    const popularChains = ['1', '56', '137', '42161', '10', '8453', '43114'];
    popularChains.forEach(id => chainIds.add(id));
    
    console.log(`Загрузка данных для ${chainIds.size} chain ID из ethereum-lists/chains...`);
    
    // Загрузка данных из ethereum-lists/chains для каждого chain ID
    for (const chainId of chainIds) {
      try {
        const url = `https://raw.githubusercontent.com/ethereum-lists/chains/refs/heads/master/_data/chains/eip155-${chainId}.json`;
        const response = await axios.get(url, { timeout: 5000 });
        const chainData = response.data;
        
        if (chainData && chainData.rpc && Array.isArray(chainData.rpc)) {
          if (!rpcList[chainId]) {
            rpcList[chainId] = [];
          }
          
          // Очищаем URL от параметров авторизации и других чувствительных данных
          const cleanRpcs = chainData.rpc.map(rpc => {
            // Удаляем параметры API ключей из URL
            return rpc.replace(/\${[^}]+}/g, '').replace(/\$\{[^}]+\}/g, '').replace(/:[^@]*@/, ':@');
          }).filter(rpc => {
            // Фильтруем пустые URL или URL с незаполненными параметрами
            return rpc && !rpc.includes('${') && !rpc.includes('$\{') && !rpc.includes(':@');
          });
          
          // Добавляем новые RPC, избегая дубликатов
          cleanRpcs.forEach(rpc => {
            if (!rpcList[chainId].includes(rpc)) {
              rpcList[chainId].push(rpc);
            }
          });
          console.log(`Загружены данные для chain ID ${chainId}: ${cleanRpcs.length} RPC`);
        }
      } catch (error) {
        console.error(`Ошибка при загрузке данных для chain ID ${chainId}:`, error.message);
      }
    }
    
    // Сохраняем обновленный список RPC в файл
    fs.writeFileSync('./rpcs.json', JSON.stringify(rpcList, null, 2), 'utf8');
    console.log('Данные RPC успешно загружены и сохранены');
    
    return true;
  } catch (error) {
    console.error('Ошибка при загрузке данных RPC из внешних источников:', error.message);
    return false;
  }
}

// Функция для тестирования RPC на возможность отправки транзакций
async function testRpcTransactionSupport(rpcUrl) {
  console.log(`Тестирование поддержки транзакций для ${rpcUrl}...`);
  try {
    // Проверяем поддержку метода eth_sendRawTransaction
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_sendRawTransaction',
      // Отправляем некорректную транзакцию, чтобы проверить только поддержку метода
      params: ['0x0123'],
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    // Если RPC поддерживает метод, он должен вернуть ошибку о некорректной транзакции,
    // но не ошибку о неподдерживаемом методе
    if (response.data.error) {
      const errorMessage = response.data.error.message || '';
      // Проверяем, что ошибка связана с форматом транзакции, а не с поддержкой метода
      if (errorMessage.toLowerCase().includes('method not found') || 
          errorMessage.toLowerCase().includes('method not supported') ||
          errorMessage.toLowerCase().includes('not implemented')) {
        console.log(`RPC ${rpcUrl} не поддерживает отправку транзакций: ${errorMessage}`);
        throw new Error('Метод отправки транзакций не поддерживается');
      }
      // Если ошибка связана с форматом транзакции, значит метод поддерживается
      console.log(`RPC ${rpcUrl} поддерживает отправку транзакций`);
      return true;
    }
    
    console.log(`RPC ${rpcUrl} поддерживает отправку транзакций`);
    return true;
  } catch (error) {
    // Проверяем сообщение об ошибке
    if (error.response && error.response.data && error.response.data.error) {
      const errorMessage = error.response.data.error.message || '';
      if (errorMessage.toLowerCase().includes('method not found') || 
          errorMessage.toLowerCase().includes('method not supported') ||
          errorMessage.toLowerCase().includes('not implemented')) {
        console.log(`RPC ${rpcUrl} не поддерживает отправку транзакций: ${errorMessage}`);
        throw new Error('Метод отправки транзакций не поддерживается');
      }
      // Если ошибка связана с форматом транзакции, значит метод поддерживается
      console.log(`RPC ${rpcUrl} поддерживает отправку транзакций (ошибка формата)`);
      return true;
    }
    
    // Если произошла ошибка соединения или таймаут, считаем RPC недоступным
    console.error(`Ошибка при проверке поддержки транзакций для ${rpcUrl}:`, error.message);
    throw error;
  }
}

// Функция для проверки поддержки различных методов RPC
async function testRpcMethodSupport(rpcUrl, method, params = []) {
  console.log(`Тестирование метода ${method} для ${rpcUrl}...`);
  
  // Проверяем, есть ли результат в кэше
  const cacheKey = `${rpcUrl}:${method}`;
  const cachedResult = rpcMethodsSupport.get(cacheKey);
  
  if (cachedResult && cachedResult.timestamp > Date.now() - RETRY_TIMEOUT) {
    if (cachedResult.supported) {
      console.log(`RPC ${rpcUrl} поддерживает метод ${method} (из кэша)`);
      return true;
    } else {
      console.log(`RPC ${rpcUrl} не поддерживает метод ${method} (из кэша)`);
      throw new Error(`Метод ${method} не поддерживается (из кэша)`);
    }
  }
  
  try {
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    // Проверяем наличие ошибки о неподдерживаемом методе
    if (response.data.error) {
      const errorMessage = response.data.error.message || '';
      if (errorMessage.toLowerCase().includes('method not found') || 
          errorMessage.toLowerCase().includes('method not supported') ||
          errorMessage.toLowerCase().includes('not implemented')) {
        // Сохраняем результат в кэш
        rpcMethodsSupport.set(cacheKey, {
          supported: false,
          timestamp: Date.now()
        });
        console.log(`RPC ${rpcUrl} не поддерживает метод ${method}: ${errorMessage}`);
        throw new Error(`Метод ${method} не поддерживается`);
      }
    }
    
    // Проверяем корректность ответа для некоторых методов
    if (method === 'eth_getBalance') {
      if (!response.data.result || typeof response.data.result !== 'string' || !response.data.result.startsWith('0x')) {
        console.log(`RPC ${rpcUrl} вернул некорректный ответ для метода ${method}`);
        throw new Error(`Некорректный ответ для метода ${method}`);
      }
    }
    
    // Сохраняем результат в кэш
    rpcMethodsSupport.set(cacheKey, {
      supported: true,
      timestamp: Date.now()
    });
    
    console.log(`RPC ${rpcUrl} успешно поддерживает метод ${method}`);
    return true;
  } catch (error) {
    // Проверяем сообщение об ошибке
    if (error.response && error.response.data && error.response.data.error) {
      const errorMessage = error.response.data.error.message || '';
      if (errorMessage.toLowerCase().includes('method not found') || 
          errorMessage.toLowerCase().includes('method not supported') ||
          errorMessage.toLowerCase().includes('not implemented')) {
        // Сохраняем результат в кэш
        rpcMethodsSupport.set(cacheKey, {
          supported: false,
          timestamp: Date.now()
        });
        console.log(`RPC ${rpcUrl} не поддерживает метод ${method}: ${errorMessage}`);
        throw new Error(`Метод ${method} не поддерживается`);
      }
    }
    
    // Если произошла другая ошибка (не связанная с поддержкой метода), пропускаем
    console.error(`Ошибка при проверке метода ${method} для ${rpcUrl}:`, error.message);
    throw error;
  }
}

// Функция для базовой проверки доступности RPC
async function testRpcAvailability(rpcUrl) {
  console.log(`Проверка доступности ${rpcUrl}...`);
  try {
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    if (response.data.error) {
      console.log(`RPC ${rpcUrl} вернул ошибку:`, response.data.error);
      throw new Error(`RPC вернул ошибку: ${response.data.error.message}`);
    }
    
    console.log(`RPC ${rpcUrl} доступен, текущий блок: ${response.data.result}`);
    return true;
  } catch (error) {
    console.error(`Ошибка при проверке доступности ${rpcUrl}:`, error.message);
    throw error;
  }
}

// Функция для тестирования RPC с проверкой поддержки транзакций и методов
async function testRpc(rpcUrl, checkTx = false, checkMethods = false) {
  console.log(`Тестирование RPC ${rpcUrl} (checkTx=${checkTx}, checkMethods=${checkMethods})...`);
  
  try {
    // Базовая проверка доступности
    await testRpcAvailability(rpcUrl);
    
    // Проверка поддержки транзакций, если требуется
    if (checkTx) {
      await testRpcTransactionSupport(rpcUrl);
    }
    
    // Проверка поддержки методов, если требуется
    if (checkMethods) {
      // Проверяем поддержку основных методов
      await testRpcMethodSupport(rpcUrl, 'eth_getBalance', ['0x0000000000000000000000000000000000000000', 'latest']);
      await testRpcMethodSupport(rpcUrl, 'eth_gasPrice', []);
      await testRpcMethodSupport(rpcUrl, 'eth_estimateGas', [{
        to: '0x0000000000000000000000000000000000000000',
        value: '0x0'
      }]);
    }
    
    console.log(`RPC ${rpcUrl} успешно прошел все проверки`);
    return true;
  } catch (error) {
    console.error(`RPC ${rpcUrl} не прошел проверку:`, error.message);
    throw error;
  }
}

// Функция для получения доступных RPC для указанного chain_id
function getAvailableRpcs(normalizedChainId, mergedRpcList) {
  console.log(`Получение доступных RPC для chain_id=${normalizedChainId}...`);
  
  if (!mergedRpcList[normalizedChainId] || mergedRpcList[normalizedChainId].length === 0) {
    console.log(`RPC для chain_id=${normalizedChainId} не найдены`);
    return [];
  }
  
  console.log(`Всего RPC для chain_id=${normalizedChainId}: ${mergedRpcList[normalizedChainId].length}`);
  
  // Фильтруем только рабочие RPC или те, которые стоит проверить снова
  const availableRpcs = mergedRpcList[normalizedChainId].filter(rpc => {
    const failedInfo = failedRpcs.get(rpc);
    const isAvailable = !failedInfo || (Date.now() - failedInfo.timestamp > RETRY_TIMEOUT);
    if (!isAvailable) {
      console.log(`RPC ${rpc} пропущен из-за недавней ошибки: ${failedInfo.error}`);
    }
    return isAvailable;
  });
  
  console.log(`Доступных RPC для chain_id=${normalizedChainId}: ${availableRpcs.length}`);
  return availableRpcs;
}

// Функция для получения работающего RPC для указанного chain_id
async function getWorkingRpc(chainId) {
  // Нормализуем chain_id (поддержка алиасов)
  const normalizedChainId = normalizeChainId(chainId);
  
  // Получаем объединенный список RPC с учетом приоритетов
  const mergedRpcList = mergeRpcLists();
  
  // Получаем доступные RPC
  const availableRpcs = getAvailableRpcs(normalizedChainId, mergedRpcList);
  
  if (availableRpcs.length === 0) {
    throw new Error(`Нет доступных RPC для chain_id=${normalizedChainId}`);
  }
  
  // Перебираем RPC, пока не найдем работающий
  for (const rpc of availableRpcs) {
    try {
      await testRpcAvailability(rpc);
      return rpc;
    } catch (error) {
      // Помечаем RPC как неработающий
      failedRpcs.set(rpc, { 
        timestamp: Date.now(),
        error: error.message
      });
      console.error(`RPC не работает: ${rpc}`, error.message);
      // Продолжаем перебор
    }
  }
  
  // Если все RPC недоступны
  throw new Error(`Все доступные RPC недоступны для chain_id=${normalizedChainId}`);
}

// Функция для получения адреса из private key
function getAddressFromPrivateKey(privateKey) {
  try {
    // Проверяем, начинается ли приватный ключ с 0x
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    // Создаем кошелек из приватного ключа
    if (ethers && ethers.Wallet) {
      const wallet = new ethers.Wallet(privateKey);
      return wallet.address;
    } else {
      throw new Error('Ethers.js не доступен для создания кошелька');
    }
  } catch (error) {
    throw new Error(`Ошибка при получении адреса из приватного ключа: ${error.message}`);
  }
}

// Функция для получения адреса из mnemonic
function getAddressFromMnemonic(mnemonic) {
  try {
    // Создаем кошелек из мнемоники
    if (ethers && ethers.Wallet && ethers.Wallet.fromMnemonic) {
      const wallet = ethers.Wallet.fromMnemonic(mnemonic);
      return wallet.address;
    } else {
      throw new Error('Ethers.js не доступен для создания кошелька из мнемоники');
    }
  } catch (error) {
    throw new Error(`Ошибка при получении адреса из мнемоники: ${error.message}`);
  }
}

// Функция для получения баланса адреса
async function getBalance(address, rpcUrl) {
  try {
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    if (response.data.error) {
      throw new Error(`RPC вернул ошибку: ${response.data.error.message}`);
    }
    
    return response.data.result;
  } catch (error) {
    throw new Error(`Ошибка при получении баланса: ${error.message}`);
  }
}

// Функция для получения цены газа
async function getGasPrice(rpcUrl) {
  try {
    // Проверяем, есть ли результат в кэше
    const cachedPrice = gasPrices.get(rpcUrl);
    if (cachedPrice && cachedPrice.timestamp > Date.now() - GAS_PRICE_CACHE_TIMEOUT) {
      console.log(`Цена газа для ${rpcUrl} получена из кэша: ${cachedPrice.price}`);
      return cachedPrice.price;
    }
    
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_gasPrice',
      params: [],
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    if (response.data.error) {
      throw new Error(`RPC вернул ошибку: ${response.data.error.message}`);
    }
    
    // Сохраняем результат в кэш
    gasPrices.set(rpcUrl, {
      price: response.data.result,
      timestamp: Date.now()
    });
    
    return response.data.result;
  } catch (error) {
    throw new Error(`Ошибка при получении цены газа: ${error.message}`);
  }
}

// Функция для оценки газа для транзакции
async function estimateGas(from, to, value, rpcUrl) {
  try {
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_estimateGas',
      params: [{
        from: from,
        to: to,
        value: value
      }],
      id: 1
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    
    if (response.data.error) {
      throw new Error(`RPC вернул ошибку: ${response.data.error.message}`);
    }
    
    return response.data.result;
  } catch (error) {
    throw new Error(`Ошибка при оценке газа: ${error.message}`);
  }
}

// Функция для получения курсов валют
async function getCurrencyRates() {
  try {
    // Проверяем, есть ли результат в кэше
    const cachedRates = currencyRates.get('rates');
    if (cachedRates && cachedRates.timestamp > Date.now() - CURRENCY_CACHE_TIMEOUT) {
      console.log('Курсы валют получены из кэша');
      return cachedRates.rates;
    }
    
    const response = await axios.get('https://ratios.wallet.brave.com/v2/relative/provider/coingecko/eth,scroll,linea,moonbeam,aurora,mantle,okx,core,unichain,matic,bnb,op,base,fantom,gnosis,avax,polygon,arbitrum,cronos,zksync,core,pulsechain,blast,moonriver,celo/usd/live', {
      headers: {
        'x-brave-key': 'qztbjzBqJueQZLFkwTTJrieu8Vw3789u'
      },
      timeout: 10000
    });
    
    if (!response.data || !response.data.payload) {
      throw new Error('Некорректный ответ от API курсов валют');
    }
    
    // Сохраняем результат в кэш
    currencyRates.set('rates', {
      rates: response.data.payload,
      timestamp: Date.now()
    });
    
    return response.data.payload;
  } catch (error) {
    throw new Error(`Ошибка при получении курсов валют: ${error.message}`);
  }
}

// Функция для конвертации hex в decimal
function hexToDecimal(hex) {
  if (!hex) return "0";
  try {
    // Проверяем, доступен ли ethers
    if (ethers && ethers.BigNumber) {
      return ethers.BigNumber.from(hex).toString();
    } else {
      // Ручная конвертация hex в decimal
      return parseInt(hex, 16).toString();
    }
  } catch (error) {
    console.error(`Ошибка при конвертации hex в decimal: ${error.message}`);
    // Ручная конвертация hex в decimal
    try {
      return parseInt(hex, 16).toString();
    } catch (e) {
      return "0";
    }
  }
}

// Функция для конвертации decimal в hex
function decimalToHex(decimal) {
  if (!decimal) return "0x0";
  try {
    // Проверяем, доступен ли ethers
    if (ethers && ethers.BigNumber) {
      return ethers.BigNumber.from(decimal).toHexString();
    } else {
      // Ручная конвертация decimal в hex
      return "0x" + parseInt(decimal).toString(16);
    }
  } catch (error) {
    console.error(`Ошибка при конвертации decimal в hex: ${error.message}`);
    // Ручная конвертация decimal в hex
    try {
      return "0x" + parseInt(decimal).toString(16);
    } catch (e) {
      return "0x0";
    }
  }
}

// Функция для конвертации wei в ether
function weiToEther(wei) {
  if (!wei) return "0";
  try {
    // Проверяем, доступен ли ethers
    if (ethers && ethers.utils && ethers.utils.formatEther) {
      return ethers.utils.formatEther(wei);
    } else {
      // Ручная конвертация wei в ether (1 ether = 10^18 wei)
      const weiValue = typeof wei === 'string' ? wei : wei.toString();
      const etherValue = parseFloat(weiValue) / Math.pow(10, 18);
      return etherValue.toString();
    }
  } catch (error) {
    console.error(`Ошибка при конвертации wei в ether: ${error.message}`);
    // Ручная конвертация wei в ether
    try {
      const weiValue = typeof wei === 'string' ? wei : wei.toString();
      const etherValue = parseFloat(weiValue) / Math.pow(10, 18);
      return etherValue.toString();
    } catch (e) {
      return "0";
    }
  }
}

// Функция для конвертации ether в wei
function etherToWei(ether) {
  if (!ether) return "0";
  try {
    // Проверяем, доступен ли ethers
    if (ethers && ethers.utils && ethers.utils.parseEther) {
      return ethers.utils.parseEther(ether).toString();
    } else {
      // Ручная конвертация ether в wei (1 ether = 10^18 wei)
      const etherValue = parseFloat(ether);
      const weiValue = etherValue * Math.pow(10, 18);
      return weiValue.toString();
    }
  } catch (error) {
    console.error(`Ошибка при конвертации ether в wei: ${error.message}`);
    // Ручная конвертация ether в wei
    try {
      const etherValue = parseFloat(ether);
      const weiValue = etherValue * Math.pow(10, 18);
      return weiValue.toString();
    } catch (e) {
      return "0";
    }
  }
}

// Функция для отправки транзакции
async function sendTransaction(privateKey, to, value, gasPrice, rpcUrl) {
  try {
    // Проверяем, доступен ли ethers
    if (ethers && ethers.providers && ethers.Wallet) {
      // Создаем провайдер и кошелек
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      
      // Создаем транзакцию
      const tx = {
        to: to,
        value: ethers.BigNumber.from(value)
      };
      
      // Если указана цена газа, добавляем ее
      if (gasPrice) {
        tx.gasPrice = ethers.BigNumber.from(gasPrice);
      }
      
      // Отправляем транзакцию
      const txResponse = await wallet.sendTransaction(tx);
      
      // Ждем подтверждения
      const receipt = await txResponse.wait();
      
      return {
        hash: txResponse.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status === 1 ? 'success' : 'failed'
      };
    } else {
      throw new Error('Ethers.js не доступен для отправки транзакций');
    }
  } catch (error) {
    throw new Error(`Ошибка при отправке транзакции: ${error.message}`);
  }
}

// Функция для вычисления keccak256 хеша
function keccak256(input) {
  // Простая реализация keccak256 для проверки адресов
  // Это упрощенная версия, которая работает только для проверки формата адреса
  // В реальном приложении следует использовать полноценную библиотеку
  
  // Для целей проверки адреса нам достаточно просто проверить формат
  return {
    toString: function() {
      return "0x" + Array(64).fill("0").join("");
    }
  };
}

// Проверка валидности Ethereum адреса
function isValidEthereumAddress(address) {
  console.log(`Проверка адреса: ${address}`);
  
  if (!address) {
    console.log('Адрес не указан');
    return false;
  }
  
  try {
    // Полностью автономная реализация проверки адреса
    
    // 1. Проверка формата: должен начинаться с 0x и содержать 42 символа (включая 0x)
    const addressRegex = /^0x[0-9a-fA-F]{40}$/;
    if (!addressRegex.test(address)) {
      console.log('Адрес не соответствует формату 0x + 40 шестнадцатеричных символов');
      return false;
    }
    
    // 2. Проверка контрольной суммы (если адрес содержит как верхний, так и нижний регистр)
    // Если адрес содержит только символы в нижнем регистре или только в верхнем регистре,
    // то это адрес без контрольной суммы, и мы его принимаем
    if (/[A-F]/.test(address) && /[a-f]/.test(address)) {
      // Адрес содержит символы в разных регистрах, проверяем контрольную сумму
      
      // Для упрощения, мы принимаем адрес с символами в разных регистрах
      // В реальном приложении здесь должна быть полная проверка контрольной суммы
      console.log('Адрес содержит символы в разных регистрах, принимаем как валидный');
      return true;
    }
    
    // Адрес без контрольной суммы (все символы в одном регистре)
    console.log('Адрес без контрольной суммы, принимаем');
    return true;
  } catch (error) {
    console.error(`Ошибка при проверке адреса: ${error.message}`);
    
    // Запасной вариант проверки адреса
    const addressRegex = /^0x[0-9a-fA-F]{40}$/;
    const isValid = addressRegex.test(address);
    console.log(`Запасная проверка адреса: ${isValid}`);
    return isValid;
  }
}

// Swagger конфигурация
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'RPC API',
      version: '1.0.0',
      description: 'API для работы с RPC и блокчейн-сетями',
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' 
          ? 'https://rpcmy2new-production.up.railway.app' 
          : `http://localhost:${PORT}`,
        description: process.env.NODE_ENV === 'production' 
          ? 'Продакшн сервер' 
          : 'Локальный сервер',
      },
    ],
  },
  apis: ['./server.js'], // Путь к файлам с JSDoc комментариями
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /rpc:
 *   get:
 *     summary: Получить доступный RPC для указанного chain_id
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас (например, 1, eth, ethereum)
 *       - in: query
 *         name: check_tx
 *         schema:
 *           type: boolean
 *         description: Проверять поддержку отправки транзакций
 *       - in: query
 *         name: check_methods
 *         schema:
 *           type: boolean
 *         description: Проверять поддержку основных методов
 *     responses:
 *       200:
 *         description: Успешный ответ с доступным RPC
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rpc:
 *                   type: string
 *       400:
 *         description: Ошибка в запросе
 *       503:
 *         description: Нет доступных RPC
 */
app.get('/rpc', async (req, res) => {
  const chainId = req.query.chain_id;
  const checkTx = req.query.check_tx === 'true'; // Параметр для проверки поддержки транзакций
  const checkMethods = req.query.check_methods === 'true'; // Параметр для проверки поддержки методов
  
  console.log(`Запрос /rpc для chain_id=${chainId}, checkTx=${checkTx}, checkMethods=${checkMethods}`);
  
  if (!chainId) {
    console.log('Ошибка: chain_id не указан');
    return res.status(400).json({ error: 'Необходимо указать chain_id' });
  }
  
  // Нормализуем chain_id (поддержка алиасов)
  const normalizedChainId = normalizeChainId(chainId);
  
  // Получаем объединенный список RPC с учетом приоритетов
  const mergedRpcList = mergeRpcLists();
  
  // Получаем доступные RPC
  const availableRpcs = getAvailableRpcs(normalizedChainId, mergedRpcList);
  
  if (availableRpcs.length === 0) {
    console.log(`Ошибка: нет доступных RPC для chain_id=${normalizedChainId}`);
    return res.status(503).json({ error: 'Нет доступных RPC для данной сети' });
  }
  
  // Выбираем первый RPC из доступных (с учетом приоритета)
  const selectedRpc = availableRpcs[0];
  console.log(`Выбран RPC: ${selectedRpc}`);
  
  try {
    // Тестируем RPC с проверкой поддержки транзакций и методов, если требуется
    await testRpc(selectedRpc, checkTx, checkMethods);
    
    // Если тест успешен, возвращаем RPC
    console.log(`Успешно проверен RPC: ${selectedRpc}`);
    return res.json({ rpc: selectedRpc });
  } catch (error) {
    console.error(`RPC не работает: ${selectedRpc}`, error.message);
    
    // Помечаем RPC как неработающий
    failedRpcs.set(selectedRpc, { 
      timestamp: Date.now(),
      error: error.message
    });
    
    // Пробуем другой RPC, если есть
    if (availableRpcs.length > 1) {
      console.log(`Пробуем другие RPC из списка (осталось ${availableRpcs.length - 1})`);
      
      // Перебираем оставшиеся RPC по порядку (с учетом приоритета)
      for (let i = 1; i < availableRpcs.length; i++) {
        const nextRpc = availableRpcs[i];
        console.log(`Пробуем RPC: ${nextRpc}`);
        
        try {
          await testRpc(nextRpc, checkTx, checkMethods);
          console.log(`Успешно проверен RPC: ${nextRpc}`);
          return res.json({ rpc: nextRpc });
        } catch (error) {
          failedRpcs.set(nextRpc, { 
            timestamp: Date.now(),
            error: error.message
          });
          console.error(`RPC не работает: ${nextRpc}`, error.message);
          // Продолжаем перебор
        }
      }
      // Если все RPC недоступны
      console.log(`Ошибка: все доступные RPC недоступны для chain_id=${normalizedChainId}`);
      return res.status(503).json({ error: 'Все доступные RPC недоступны' });
    } else {
      console.log(`Ошибка: все доступные RPC недоступны для chain_id=${normalizedChainId}`);
      return res.status(503).json({ error: 'Все доступные RPC недоступны' });
    }
  }
});

/**
 * @swagger
 * /rpc_d:
 *   post:
 *     summary: Прокси для RPC запросов (POST)
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас (например, 1, eth, ethereum)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jsonrpc:
 *                 type: string
 *               method:
 *                 type: string
 *               params:
 *                 type: array
 *               id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Ответ от RPC
 *       400:
 *         description: Ошибка в запросе
 *       503:
 *         description: Нет доступных RPC
 */
app.post('/rpc_d', async (req, res) => {
  const chainId = req.query.chain_id;
  
  console.log(`Запрос /rpc_d для chain_id=${chainId}, метод=POST`);
  console.log('Тело запроса:', JSON.stringify(req.body));
  
  if (!chainId) {
    console.log('Ошибка: chain_id не указан');
    return res.status(400).json({ error: 'Необходимо указать chain_id' });
  }
  
  // Нормализуем chain_id (поддержка алиасов)
  const normalizedChainId = normalizeChainId(chainId);
  
  // Получаем объединенный список RPC с учетом приоритетов
  const mergedRpcList = mergeRpcLists();
  
  // Получаем доступные RPC
  const availableRpcs = getAvailableRpcs(normalizedChainId, mergedRpcList);
  
  if (availableRpcs.length === 0) {
    console.log(`Ошибка: нет доступных RPC для chain_id=${normalizedChainId}`);
    return res.status(503).json({ error: 'Нет доступных RPC для данной сети' });
  }
  
  // Получаем метод из тела запроса для проверки поддержки
  let requestMethod = 'eth_blockNumber'; // По умолчанию
  let requestParams = [];
  
  try {
    if (req.body && req.body.method) {
      requestMethod = req.body.method;
      requestParams = req.body.params || [];
      console.log(`Запрошенный метод: ${requestMethod}, параметры:`, requestParams);
    }
  } catch (e) {
    console.error('Ошибка при получении метода из тела запроса:', e.message);
  }
  
  // Выбираем первый RPC из доступных (с учетом приоритета)
  const selectedRpc = availableRpcs[0];
  console.log(`Выбран RPC для прокси: ${selectedRpc}`);
  
  try {
    // Базовая проверка доступности
    await testRpcAvailability(selectedRpc);
    
    // Получаем тело запроса и заголовки
    const requestBody = req.body;
    const contentType = req.headers['content-type'] || 'application/json';
    
    console.log(`Проксирование запроса к ${selectedRpc}...`);
    
    // Проксируем запрос к выбранному RPC
    const proxyResponse = await axios({
      method: 'post',
      url: selectedRpc,
      data: requestBody,
      headers: {
        'Content-Type': contentType
      },
      timeout: REQUEST_TIMEOUT * 2 // Увеличиваем таймаут для прокси-запросов
    });
    
    console.log(`Получен ответ от ${selectedRpc}:`, proxyResponse.data);
    
    // Возвращаем ответ от RPC
    return res.status(proxyResponse.status).json(proxyResponse.data);
  } catch (error) {
    console.error(`Ошибка при проксировании запроса к RPC ${selectedRpc}:`, error.message);
    
    // Помечаем RPC как неработающий
    failedRpcs.set(selectedRpc, { 
      timestamp: Date.now(),
      error: error.message
    });
    
    // Пробуем другие RPC по порядку, если есть
    if (availableRpcs.length > 1) {
      console.log(`Пробуем другие RPC из списка для прокси (осталось ${availableRpcs.length - 1})`);
      
      // Перебираем оставшиеся RPC по порядку (с учетом приоритета)
      for (let i = 1; i < availableRpcs.length; i++) {
        const nextRpc = availableRpcs[i];
        console.log(`Пробуем RPC для прокси: ${nextRpc}`);
        
        try {
          // Базовая проверка доступности
          await testRpcAvailability(nextRpc);
          
          // Получаем тело запроса и заголовки
          const requestBody = req.body;
          const contentType = req.headers['content-type'] || 'application/json';
          
          console.log(`Проксирование запроса к ${nextRpc}...`);
          
          // Проксируем запрос к новому выбранному RPC
          const proxyResponse = await axios({
            method: 'post',
            url: nextRpc,
            data: requestBody,
            headers: {
              'Content-Type': contentType
            },
            timeout: REQUEST_TIMEOUT * 2
          });
          
          console.log(`Получен ответ от ${nextRpc}:`, proxyResponse.data);
          
          // Возвращаем ответ от RPC
          return res.status(proxyResponse.status).json(proxyResponse.data);
        } catch (error) {
          failedRpcs.set(nextRpc, { 
            timestamp: Date.now(),
            error: error.message
          });
          console.error(`RPC не работает: ${nextRpc}`, error.message);
          // Продолжаем перебор
        }
      }
      // Если все RPC недоступны
      console.log(`Ошибка: все доступные RPC недоступны для chain_id=${normalizedChainId}`);
      return res.status(503).json({ error: 'Все доступные RPC недоступны' });
    } else {
      console.log(`Ошибка: все доступные RPC недоступны для chain_id=${normalizedChainId}`);
      return res.status(503).json({ error: 'Все доступные RPC недоступны' });
    }
  }
});

/**
 * @swagger
 * /rpc_d:
 *   get:
 *     summary: Прокси для RPC запросов (GET)
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас (например, 1, eth, ethereum)
 *       - in: query
 *         name: method
 *         schema:
 *           type: string
 *         description: Метод RPC (например, eth_blockNumber)
 *     responses:
 *       200:
 *         description: Ответ от RPC
 *       400:
 *         description: Ошибка в запросе
 *       503:
 *         description: Нет доступных RPC
 */
app.get('/rpc_d', async (req, res) => {
  const chainId = req.query.chain_id;
  const method = req.query.method || 'eth_blockNumber';
  
  console.log(`Запрос /rpc_d для chain_id=${chainId}, метод=GET, rpc_method=${method}`);
  
  if (!chainId) {
    console.log('Ошибка: chain_id не указан');
    return res.status(400).json({ error: 'Необходимо указать chain_id' });
  }
  
  // Нормализуем chain_id (поддержка алиасов)
  const normalizedChainId = normalizeChainId(chainId);
  
  // Получаем объединенный список RPC с учетом приоритетов
  const mergedRpcList = mergeRpcLists();
  
  // Получаем доступные RPC
  const availableRpcs = getAvailableRpcs(normalizedChainId, mergedRpcList);
  
  if (availableRpcs.length === 0) {
    console.log(`Ошибка: нет доступных RPC для chain_id=${normalizedChainId}`);
    return res.status(503).json({ error: 'Нет доступных RPC для данной сети' });
  }
  
  // Выбираем первый RPC из доступных (с учетом приоритета)
  const selectedRpc = availableRpcs[0];
  console.log(`Выбран RPC для прокси: ${selectedRpc}`);
  
  try {
    // Базовая проверка доступности
    await testRpcAvailability(selectedRpc);
    
    // Создаем тело запроса
    const requestBody = {
      jsonrpc: '2.0',
      method: method,
      params: [],
      id: 1
    };
    
    console.log(`Проксирование GET запроса к ${selectedRpc}...`);
    
    // Проксируем запрос к выбранному RPC
    const proxyResponse = await axios({
      method: 'post',
      url: selectedRpc,
      data: requestBody,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT * 2
    });
    
    console.log(`Получен ответ от ${selectedRpc}:`, proxyResponse.data);
    
    // Возвращаем ответ от RPC
    return res.status(proxyResponse.status).json(proxyResponse.data);
  } catch (error) {
    console.error(`Ошибка при проксировании запроса к RPC ${selectedRpc}:`, error.message);
    
    // Помечаем RPC как неработающий
    failedRpcs.set(selectedRpc, { 
      timestamp: Date.now(),
      error: error.message
    });
    
    // Пробуем другие RPC по порядку, если есть
    if (availableRpcs.length > 1) {
      console.log(`Пробуем другие RPC из списка для прокси (осталось ${availableRpcs.length - 1})`);
      
      // Перебираем оставшиеся RPC по порядку (с учетом приоритета)
      for (let i = 1; i < availableRpcs.length; i++) {
        const nextRpc = availableRpcs[i];
        console.log(`Пробуем RPC для прокси: ${nextRpc}`);
        
        try {
          // Базовая проверка доступности
          await testRpcAvailability(nextRpc);
          
          // Создаем тело запроса
          const requestBody = {
            jsonrpc: '2.0',
            method: method,
            params: [],
            id: 1
          };
          
          console.log(`Проксирование GET запроса к ${nextRpc}...`);
          
          // Проксируем запрос к новому выбранному RPC
          const proxyResponse = await axios({
            method: 'post',
            url: nextRpc,
            data: requestBody,
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: REQUEST_TIMEOUT * 2
          });
          
          console.log(`Получен ответ от ${nextRpc}:`, proxyResponse.data);
          
          // Возвращаем ответ от RPC
          return res.status(proxyResponse.status).json(proxyResponse.data);
        } catch (error) {
          failedRpcs.set(nextRpc, { 
            timestamp: Date.now(),
            error: error.message
          });
          console.error(`RPC не работает: ${nextRpc}`, error.message);
          // Продолжаем перебор
        }
      }
      // Если все RPC недоступны
      console.log(`Ошибка: все доступные RPC недоступны для chain_id=${normalizedChainId}`);
      return res.status(503).json({ error: 'Все доступные RPC недоступны' });
    } else {
      console.log(`Ошибка: все доступные RPC недоступны для chain_id=${normalizedChainId}`);
      return res.status(503).json({ error: 'Все доступные RPC недоступны' });
    }
  }
});

/**
 * @swagger
 * /balance:
 *   get:
 *     summary: Получить баланс адреса, приватного ключа или мнемоники
 *     parameters:
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Ethereum адрес
 *       - in: query
 *         name: private_key
 *         schema:
 *           type: string
 *         description: Приватный ключ
 *       - in: query
 *         name: mnemonic
 *         schema:
 *           type: string
 *         description: Мнемоническая фраза
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети, алиас или "all" для всех сетей
 *     responses:
 *       200:
 *         description: Баланс адреса
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/balance', async (req, res) => {
  try {
    const { address, private_key, mnemonic, chain_id } = req.query;
    
    // Проверяем, что указан хотя бы один из параметров: address, private_key или mnemonic
    if (!address && !private_key && !mnemonic) {
      return res.status(400).json({ error: 'Необходимо указать address, private_key или mnemonic' });
    }
    
    // Проверяем, что указан chain_id
    if (!chain_id) {
      return res.status(400).json({ error: 'Необходимо указать chain_id' });
    }
    
    // Определяем адрес для проверки баланса
    let targetAddress;
    
    if (address) {
      targetAddress = address;
    } else if (private_key) {
      try {
        targetAddress = getAddressFromPrivateKey(private_key);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    } else if (mnemonic) {
      try {
        targetAddress = getAddressFromMnemonic(mnemonic);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }
    
    // Проверяем, что адрес валидный
    if (!isValidEthereumAddress(targetAddress)) {
      return res.status(400).json({ error: 'Некорректный Ethereum адрес' });
    }
    
    // Если chain_id = "all", получаем балансы для всех доступных сетей
    if (chain_id.toLowerCase() === 'all') {
      const mergedRpcList = mergeRpcLists();
      const results = {};
      
      // Получаем балансы для всех сетей параллельно
      const promises = Object.keys(mergedRpcList).map(async (chainId) => {
        try {
          const rpc = await getWorkingRpc(chainId);
          const balanceHex = await getBalance(targetAddress, rpc);
          const balanceWei = hexToDecimal(balanceHex);
          const balanceEth = weiToEther(balanceWei);
          
          results[chainId] = {
            chain_id: chainId,
            address: targetAddress,
            balance_wei: balanceWei,
            balance_eth: balanceEth,
            balance_hex: balanceHex
          };
        } catch (error) {
          console.error(`Ошибка при получении баланса для chain_id=${chainId}:`, error.message);
          // Пропускаем сети с ошибками
        }
      });
      
      // Ждем завершения всех запросов
      await Promise.all(promises);
      
      return res.json({
        address: targetAddress,
        balances: results
      });
    } else {
      // Получаем баланс для указанной сети
      try {
        const normalizedChainId = normalizeChainId(chain_id);
        const rpc = await getWorkingRpc(normalizedChainId);
        const balanceHex = await getBalance(targetAddress, rpc);
        const balanceWei = hexToDecimal(balanceHex);
        const balanceEth = weiToEther(balanceWei);
        
        return res.json({
          chain_id: normalizedChainId,
          address: targetAddress,
          balance_wei: balanceWei,
          balance_eth: balanceEth,
          balance_hex: balanceHex
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
  } catch (error) {
    console.error('Ошибка при получении баланса:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /eth_to_usd:
 *   get:
 *     summary: Конвертировать ETH в USD
 *     parameters:
 *       - in: query
 *         name: amount
 *         schema:
 *           type: string
 *         description: Количество ETH для конвертации
 *       - in: query
 *         name: chain_id
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас для выбора валюты
 *     responses:
 *       200:
 *         description: Результат конвертации
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/eth_to_usd', async (req, res) => {
  try {
    const { amount, chain_id } = req.query;
    
    // Проверяем, что указана сумма
    if (!amount) {
      return res.status(400).json({ error: 'Необходимо указать amount' });
    }
    
    // Получаем курсы валют
    const rates = await getCurrencyRates();
    
    // Если указан chain_id, конвертируем для указанной сети
    if (chain_id) {
      const normalizedChainId = normalizeChainId(chain_id);
      
      // Определяем символ валюты для указанной сети
      let symbol = 'eth'; // По умолчанию Ethereum
      
      // Маппинг chain_id на символы валют в API Brave
      const chainSymbolMap = {
        '1': 'eth',
        '56': 'bnb',
        '137': 'matic',
        '42161': 'arbitrum',
        '10': 'op',
        '8453': 'base',
        '43114': 'avax',
        '250': 'fantom',
        '100': 'gnosis',
        '324': 'zksync',
        '25': 'cronos',
        '81457': 'blast',
        '42220': 'celo',
        '1284': 'moonbeam',
        '1285': 'moonriver',
        '534352': 'scroll',
        '59144': 'linea',
        '1101': 'polygon'
      };
      
      if (chainSymbolMap[normalizedChainId]) {
        symbol = chainSymbolMap[normalizedChainId];
      }
      
      // Проверяем, есть ли курс для указанной сети
      if (!rates[symbol]) {
        return res.status(400).json({ error: `Курс для chain_id=${normalizedChainId} (${symbol}) не найден` });
      }
      
      // Конвертируем сумму
      const usdRate = rates[symbol].usd;
      const usdAmount = parseFloat(amount) * usdRate;
      
      return res.json({
        chain_id: normalizedChainId,
        symbol: symbol,
        amount: amount,
        usd_rate: usdRate,
        usd_amount: usdAmount,
        usd_timeframe_change: rates[symbol].usd_timeframe_change
      });
    } else {
      // Если chain_id не указан, возвращаем все курсы
      const result = {};
      
      Object.keys(rates).forEach(symbol => {
        const usdRate = rates[symbol].usd;
        const usdAmount = parseFloat(amount) * usdRate;
        
        result[symbol] = {
          amount: amount,
          usd_rate: usdRate,
          usd_amount: usdAmount,
          usd_timeframe_change: rates[symbol].usd_timeframe_change
        };
      });
      
      return res.json({
        amount: amount,
        conversions: result
      });
    }
  } catch (error) {
    console.error('Ошибка при конвертации ETH в USD:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /gas_price:
 *   get:
 *     summary: Получить цену газа для указанной сети
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети, алиас или "all" для всех сетей
 *     responses:
 *       200:
 *         description: Цена газа
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/gas_price', async (req, res) => {
  try {
    const { chain_id } = req.query;
    
    // Проверяем, что указан chain_id
    if (!chain_id) {
      return res.status(400).json({ error: 'Необходимо указать chain_id' });
    }
    
    // Если chain_id = "all", получаем цены газа для всех доступных сетей
    if (chain_id.toLowerCase() === 'all') {
      const mergedRpcList = mergeRpcLists();
      const results = {};
      
      // Получаем цены газа для всех сетей параллельно
      const promises = Object.keys(mergedRpcList).map(async (chainId) => {
        try {
          const rpc = await getWorkingRpc(chainId);
          const gasPriceHex = await getGasPrice(rpc);
          const gasPriceWei = hexToDecimal(gasPriceHex);
          
          // Проверяем, доступен ли ethers для форматирования
          let gasPriceGwei;
          if (ethers && ethers.utils && ethers.utils.formatUnits) {
            gasPriceGwei = ethers.utils.formatUnits(gasPriceWei, 'gwei');
          } else {
            // Ручное форматирование в gwei (1 gwei = 10^9 wei)
            gasPriceGwei = (parseFloat(gasPriceWei) / Math.pow(10, 9)).toString();
          }
          
          results[chainId] = {
            chain_id: chainId,
            gas_price_wei: gasPriceWei,
            gas_price_gwei: gasPriceGwei,
            gas_price_hex: gasPriceHex
          };
        } catch (error) {
          console.error(`Ошибка при получении цены газа для chain_id=${chainId}:`, error.message);
          // Пропускаем сети с ошибками
        }
      });
      
      // Ждем завершения всех запросов
      await Promise.all(promises);
      
      return res.json({
        gas_prices: results
      });
    } else {
      // Получаем цену газа для указанной сети
      try {
        const normalizedChainId = normalizeChainId(chain_id);
        const rpc = await getWorkingRpc(normalizedChainId);
        const gasPriceHex = await getGasPrice(rpc);
        const gasPriceWei = hexToDecimal(gasPriceHex);
        
        // Проверяем, доступен ли ethers для форматирования
        let gasPriceGwei;
        if (ethers && ethers.utils && ethers.utils.formatUnits) {
          gasPriceGwei = ethers.utils.formatUnits(gasPriceWei, 'gwei');
        } else {
          // Ручное форматирование в gwei (1 gwei = 10^9 wei)
          gasPriceGwei = (parseFloat(gasPriceWei) / Math.pow(10, 9)).toString();
        }
        
        return res.json({
          chain_id: normalizedChainId,
          gas_price_wei: gasPriceWei,
          gas_price_gwei: gasPriceGwei,
          gas_price_hex: gasPriceHex
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }
  } catch (error) {
    console.error('Ошибка при получении цены газа:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /gas_estimate:
 *   get:
 *     summary: Оценить газ для транзакции
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *         description: Адрес отправителя
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *         description: Адрес получателя
 *       - in: query
 *         name: value
 *         schema:
 *           type: string
 *         description: Сумма в wei
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас
 *     responses:
 *       200:
 *         description: Оценка газа
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/gas_estimate', async (req, res) => {
  try {
    const { from, to, value, chain_id } = req.query;
    
    // Проверяем, что указаны обязательные параметры
    if (!to) {
      return res.status(400).json({ error: 'Необходимо указать to' });
    }
    
    if (!chain_id) {
      return res.status(400).json({ error: 'Необходимо указать chain_id' });
    }
    
    // Проверяем, что адреса валидные
    if (from && !isValidEthereumAddress(from)) {
      return res.status(400).json({ error: 'Некорректный адрес отправителя' });
    }
    
    if (!isValidEthereumAddress(to)) {
      return res.status(400).json({ error: 'Некорректный адрес получателя' });
    }
    
    // Получаем RPC для указанной сети
    const normalizedChainId = normalizeChainId(chain_id);
    const rpc = await getWorkingRpc(normalizedChainId);
    
    // Оцениваем газ
    const valueHex = value ? decimalToHex(value) : '0x0';
    const gasHex = await estimateGas(from || to, to, valueHex, rpc);
    const gasDecimal = hexToDecimal(gasHex);
    
    // Получаем цену газа
    const gasPriceHex = await getGasPrice(rpc);
    const gasPriceWei = hexToDecimal(gasPriceHex);
    
    // Проверяем, доступен ли ethers для форматирования
    let gasPriceGwei;
    if (ethers && ethers.utils && ethers.utils.formatUnits) {
      gasPriceGwei = ethers.utils.formatUnits(gasPriceWei, 'gwei');
    } else {
      // Ручное форматирование в gwei (1 gwei = 10^9 wei)
      gasPriceGwei = (parseFloat(gasPriceWei) / Math.pow(10, 9)).toString();
    }
    
    // Рассчитываем стоимость газа
    let gasCostWei;
    if (ethers && ethers.BigNumber) {
      gasCostWei = ethers.BigNumber.from(gasDecimal).mul(ethers.BigNumber.from(gasPriceWei)).toString();
    } else {
      // Ручное умножение
      gasCostWei = (BigInt(gasDecimal) * BigInt(gasPriceWei)).toString();
    }
    
    const gasCostEth = weiToEther(gasCostWei);
    
    return res.json({
      chain_id: normalizedChainId,
      from: from || null,
      to: to,
      value: value || '0',
      gas: gasDecimal,
      gas_hex: gasHex,
      gas_price_wei: gasPriceWei,
      gas_price_gwei: gasPriceGwei,
      gas_price_hex: gasPriceHex,
      gas_cost_wei: gasCostWei,
      gas_cost_eth: gasCostEth
    });
  } catch (error) {
    console.error('Ошибка при оценке газа:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /gas_re:
 *   get:
 *     summary: Рассчитать максимальную сумму для вывода с учетом газа
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *         description: Адрес отправителя
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *         description: Адрес получателя
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас
 *     responses:
 *       200:
 *         description: Максимальная сумма для вывода
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/gas_re', async (req, res) => {
  try {
    const { from, to, chain_id } = req.query;
    
    // Проверяем, что указаны обязательные параметры
    if (!from) {
      return res.status(400).json({ error: 'Необходимо указать from' });
    }
    
    if (!to) {
      return res.status(400).json({ error: 'Необходимо указать to' });
    }
    
    if (!chain_id) {
      return res.status(400).json({ error: 'Необходимо указать chain_id' });
    }
    
    // Проверяем, что адреса валидные
    if (!isValidEthereumAddress(from)) {
      return res.status(400).json({ error: 'Некорректный адрес отправителя' });
    }
    
    if (!isValidEthereumAddress(to)) {
      return res.status(400).json({ error: 'Некорректный адрес получателя' });
    }
    
    // Получаем RPC для указанной сети
    const normalizedChainId = normalizeChainId(chain_id);
    const rpc = await getWorkingRpc(normalizedChainId);
    
    // Получаем баланс отправителя
    const balanceHex = await getBalance(from, rpc);
    
    // Преобразуем баланс в BigNumber или BigInt
    let balanceWei;
    if (ethers && ethers.BigNumber) {
      balanceWei = ethers.BigNumber.from(balanceHex);
    } else {
      // Используем BigInt для больших чисел
      balanceWei = BigInt(balanceHex);
    }
    
    const balanceEth = weiToEther(balanceWei.toString());
    
    // Оцениваем газ для транзакции с нулевой суммой
    const gasHex = await estimateGas(from, to, '0x0', rpc);
    
    // Преобразуем газ в BigNumber или BigInt
    let gasDecimal;
    if (ethers && ethers.BigNumber) {
      gasDecimal = ethers.BigNumber.from(gasHex);
    } else {
      // Используем BigInt для больших чисел
      gasDecimal = BigInt(gasHex);
    }
    
    // Получаем цену газа
    const gasPriceHex = await getGasPrice(rpc);
    
    // Преобразуем цену газа в BigNumber или BigInt
    let gasPriceWei;
    if (ethers && ethers.BigNumber) {
      gasPriceWei = ethers.BigNumber.from(gasPriceHex);
    } else {
      // Используем BigInt для больших чисел
      gasPriceWei = BigInt(gasPriceHex);
    }
    
    // Рассчитываем стоимость газа
    let gasCostWei;
    if (ethers && ethers.BigNumber) {
      gasCostWei = gasDecimal.mul(gasPriceWei);
    } else {
      // Используем BigInt для умножения
      gasCostWei = gasDecimal * gasPriceWei;
    }
    
    const gasCostEth = weiToEther(gasCostWei.toString());
    
    // Рассчитываем максимальную сумму для вывода
    let maxValueWei;
    
    // Проверяем, достаточно ли баланса для оплаты газа
    let isBalanceSufficient;
    if (ethers && ethers.BigNumber) {
      isBalanceSufficient = balanceWei.gte(gasCostWei);
    } else {
      isBalanceSufficient = balanceWei >= gasCostWei;
    }
    
    if (!isBalanceSufficient) {
      // Если баланс меньше стоимости газа, то вывести ничего нельзя
      if (ethers && ethers.BigNumber) {
        maxValueWei = ethers.BigNumber.from(0);
      } else {
        maxValueWei = BigInt(0);
      }
    } else {
      // Иначе максимальная сумма = баланс - стоимость газа
      if (ethers && ethers.BigNumber) {
        maxValueWei = balanceWei.sub(gasCostWei);
      } else {
        maxValueWei = balanceWei - gasCostWei;
      }
    }
    
    const maxValueEth = weiToEther(maxValueWei.toString());
    
    // Преобразуем в hex
    let maxValueHex;
    if (ethers && ethers.BigNumber) {
      maxValueHex = maxValueWei.toHexString();
    } else {
      // Ручное преобразование в hex
      maxValueHex = "0x" + maxValueWei.toString(16);
    }
    
    return res.json({
      chain_id: normalizedChainId,
      from: from,
      to: to,
      balance_wei: balanceWei.toString(),
      balance_eth: balanceEth,
      gas: gasDecimal.toString(),
      gas_price_wei: gasPriceWei.toString(),
      gas_cost_wei: gasCostWei.toString(),
      gas_cost_eth: gasCostEth,
      max_value_wei: maxValueWei.toString(),
      max_value_eth: maxValueEth,
      max_value_hex: maxValueHex
    });
  } catch (error) {
    console.error('Ошибка при расчете максимальной суммы для вывода:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /send_transaction:
 *   get:
 *     summary: Отправить транзакцию с максимальной суммой
 *     parameters:
 *       - in: query
 *         name: private_key
 *         required: true
 *         schema:
 *           type: string
 *         description: Приватный ключ отправителя
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *         description: Адрес получателя
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас
 *     responses:
 *       200:
 *         description: Результат отправки транзакции
 *       400:
 *         description: Ошибка в запросе
 *       500:
 *         description: Ошибка сервера
 */
app.get('/send_transaction', async (req, res) => {
  try {
    const { private_key, to, chain_id } = req.query;
    
    // Проверяем, что указаны обязательные параметры
    if (!private_key) {
      return res.status(400).json({ error: 'Необходимо указать private_key' });
    }
    
    if (!to) {
      return res.status(400).json({ error: 'Необходимо указать to' });
    }
    
    if (!chain_id) {
      return res.status(400).json({ error: 'Необходимо указать chain_id' });
    }
    
    // Проверяем, доступен ли ethers для отправки транзакций
    if (!ethers || !ethers.providers || !ethers.Wallet) {
      return res.status(500).json({ error: 'Ethers.js не доступен для отправки транзакций' });
    }
    
    // Получаем адрес отправителя из приватного ключа
    let from;
    try {
      from = getAddressFromPrivateKey(private_key);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    
    // Проверяем, что адрес получателя валидный
    if (!isValidEthereumAddress(to)) {
      return res.status(400).json({ error: 'Некорректный адрес получателя' });
    }
    
    // Получаем RPC для указанной сети
    const normalizedChainId = normalizeChainId(chain_id);
    const rpc = await getWorkingRpc(normalizedChainId);
    
    // Получаем баланс отправителя
    const balanceHex = await getBalance(from, rpc);
    const balanceWei = ethers.BigNumber.from(balanceHex);
    
    // Оцениваем газ для транзакции с нулевой суммой
    const gasHex = await estimateGas(from, to, '0x0', rpc);
    const gasDecimal = ethers.BigNumber.from(gasHex);
    
    // Получаем цену газа
    const gasPriceHex = await getGasPrice(rpc);
    const gasPriceWei = ethers.BigNumber.from(gasPriceHex);
    
    // Рассчитываем стоимость газа
    const gasCostWei = gasDecimal.mul(gasPriceWei);
    
    // Рассчитываем максимальную сумму для вывода
    let maxValueWei;
    if (balanceWei.lte(gasCostWei)) {
      // Если баланс меньше стоимости газа, то вывести ничего нельзя
      return res.status(400).json({ 
        error: 'Недостаточно средств для оплаты газа',
        balance_wei: balanceWei.toString(),
        gas_cost_wei: gasCostWei.toString()
      });
    } else {
      // Иначе максимальная сумма = баланс - стоимость газа
      maxValueWei = balanceWei.sub(gasCostWei);
    }
    
    // Отправляем транзакцию
    const txResult = await sendTransaction(
      private_key,
      to,
      maxValueWei.toHexString(),
      gasPriceHex,
      rpc
    );
    
    return res.json({
      chain_id: normalizedChainId,
      from: from,
      to: to,
      value_wei: maxValueWei.toString(),
      value_eth: weiToEther(maxValueWei),
      gas_price_wei: gasPriceWei.toString(),
      gas_price_gwei: ethers.utils.formatUnits(gasPriceWei, 'gwei'),
      gas_limit: gasDecimal.toString(),
      transaction: txResult
    });
  } catch (error) {
    console.error('Ошибка при отправке транзакции:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /aliases:
 *   get:
 *     summary: Получить список алиасов для указанного chain_id
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети
 *     responses:
 *       200:
 *         description: Список алиасов
 *       400:
 *         description: Ошибка в запросе
 */
app.get('/aliases', async (req, res) => {
  try {
    const { chain_id } = req.query;
    
    // Если chain_id не указан, возвращаем все алиасы
    if (!chain_id) {
      return res.json(chainIdToAliasesMap);
    }
    
    // Нормализуем chain_id (поддержка алиасов)
    const normalizedChainId = normalizeChainId(chain_id);
    
    // Получаем алиасы для указанного chain_id
    const aliases = chainIdToAliasesMap[normalizedChainId] || [];
    
    return res.json({
      chain_id: normalizedChainId,
      aliases: aliases
    });
  } catch (error) {
    console.error('Ошибка при получении алиасов:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Запускаем сервер
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log('Версия Node.js:', process.version);
  console.log('Версия ethers:', ethers ? (ethers.version || 'доступен, но версия неизвестна') : 'недоступен');
  
  // Загружаем данные RPC из внешних источников при запуске
  loadRpcDataFromExternalSources();
  
  // Запускаем периодическую проверку и обновление данных RPC
  setInterval(() => {
    console.log('Запуск периодического обновления данных RPC...');
    loadRpcDataFromExternalSources();
  }, CHECK_INTERVAL);
});
