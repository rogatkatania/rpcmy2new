const express = require("express");
const axios = require("axios");
const fs = require("fs");
const { ethers } = require("ethers");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const cors = require("cors"); // Добавляем CORS

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для обработки JSON-запросов - должен быть в начале!
app.use(express.json());

// Включаем CORS для всех запросов
app.use(cors());

// Загружаем алиасы chain_id из JSON-файла
let chainIdAliasesMap = new Map();
let chainIdToAliasesMap = {};

try {
  console.log("Загрузка алиасов chain_id из файла...");
  const aliasesPath = "./chain_id_aliases.json";
  
  if (fs.existsSync(aliasesPath)) {
    const aliasesContent = fs.readFileSync(aliasesPath, "utf8");
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
    console.log("Файл с алиасами не найден, создаем новый");
    
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
    fs.writeFileSync(aliasesPath, JSON.stringify(basicAliases, null, 2), "utf8");
    
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
  console.error("Ошибка при загрузке алиасов chain_id:", err.message);
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
let priorityRpcList;
try {
  // Загружаем приоритетные RPC из файла
  const priorityRpcContent = fs.readFileSync("./priority_rpcs.json", "utf8");
  priorityRpcList = JSON.parse(priorityRpcContent);
  console.log("Загружен список приоритетных RPC");
} catch (err) {
  console.log("Файл с приоритетными RPC не найден, создаем новый");
  priorityRpcList = {};
  
  // Сохраняем приоритетные RPC из предоставленного списка
  try {
    // Пытаемся прочитать файл, который мог быть загружен
    const priorityRpcData = fs.readFileSync("/home/ubuntu/upload/pasted_content.txt", "utf8");
    priorityRpcList = JSON.parse(priorityRpcData);
    fs.writeFileSync("./priority_rpcs.json", JSON.stringify(priorityRpcList, null, 2), "utf8");
    console.log("Создан новый файл с приоритетными RPC");
  } catch (priorityErr) {
    console.error("Ошибка при создании файла с приоритетными RPC:", priorityErr.message);
  }
}

// Загружаем список RPC-узлов из JSON-файла или из переменной окружения
let rpcList = {};
try {
  // Пробуем загрузить из файла
  if (fs.existsSync("./rpcs.json")) {
    rpcList = JSON.parse(fs.readFileSync("./rpcs.json", "utf8"));
    console.log("Загружен основной список RPC из файла");
  } else if (process.env.RPC_LIST) {
    try {
      rpcList = JSON.parse(process.env.RPC_LIST);
      console.log("Загружен основной список RPC из переменной окружения");
    } catch (parseErr) {
      console.error("Ошибка парсинга RPC_LIST:", parseErr.message);
    }
  } else {
    console.log("Не удалось загрузить список RPC из локальных источников. Будет использован только приоритетный список.");
  }
} catch (err) {
  console.error("Ошибка при загрузке основного списка RPC:", err.message);
}

// Объединяем приоритетные RPC с основным списком
function mergeRpcLists() {
  console.log("Объединение списков RPC...");
  
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
    console.log("Загрузка RPC данных из внешних источников...");
    
    // Загрузка данных из chainlist.org
    try {
      const chainlistResponse = await axios.get("https://chainlist.org/rpcs.json", { timeout: 10000 });
      const chainlistData = chainlistResponse.data;
      
      // Обработка данных из chainlist.org
      if (chainlistData && typeof chainlistData === "object") {
        Object.keys(chainlistData).forEach(chainId => {
          if (!rpcList[chainId]) {
            rpcList[chainId] = [];
          }
          
          // Добавляем новые RPC, избегая дубликатов
          chainlistData[chainId].forEach(rpc => {
            if (!rpcList[chainId].includes(rpc)) {
              rpcList[chainId].push(rpc);
            }
          });
        });
        console.log("Данные из chainlist.org успешно загружены");
      }
    } catch (chainlistError) {
      console.error("Ошибка при загрузке данных из chainlist.org:", chainlistError.message);
    }
    
    // Получаем список всех chain ID из текущего списка для загрузки данных из ethereum-lists/chains
    const chainIds = new Set([...Object.keys(rpcList), ...Object.keys(priorityRpcList)]);
    
    // Добавляем популярные сети, если их нет в списке
    const popularChains = ["1", "56", "137", "42161", "10", "8453", "43114"];
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
            return rpc.replace(/\${[^}]+}/g, "").replace(/\$\{[^}]+\}/g, "").replace(/:[^@]*@/, ":@");
          }).filter(rpc => {
            // Фильтруем пустые URL или URL с незаполненными параметрами
            return rpc && !rpc.includes("${") && !rpc.includes("${") && !rpc.includes(":@");
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
    fs.writeFileSync("./rpcs.json", JSON.stringify(rpcList, null, 2), "utf8");
    console.log("Данные RPC успешно загружены и сохранены");
    
    return true;
  } catch (error) {
    console.error("Ошибка при загрузке данных RPC из внешних источников:", error.message);
    return false;
  }
}

// Функция для тестирования RPC на возможность отправки транзакций
async function testRpcTransactionSupport(rpcUrl) {
  console.log(`Тестирование поддержки транзакций для ${rpcUrl}...`);
  try {
    // Проверяем поддержку метода eth_sendRawTransaction
    const response = await axios.post(rpcUrl, {
      jsonrpc: "2.0",
      method: "eth_sendRawTransaction",
      // Отправляем некорректную транзакцию, чтобы проверить только поддержку метода
      params: ["0x0123"],
      id: 1
    }, {
      headers: {
        "Content-Type": "application/json"
      },
      timeout: REQUEST_TIMEOUT
    });
    
    // Если RPC поддерживает метод, он должен вернуть ошибку о некорректной транзакции,
    // но не ошибку о неподдерживаемом методе
    if (response.data.error) {
      const errorMessage = response.data.error.message || "";
      // Проверяем, что ошибка связана с форматом транзакции, а не с поддержкой метода
      if (errorMessage.toLowerCase().includes("method not found") || 
          errorMessage.toLowerCase().includes("method not supported") ||
          errorMessage.toLowerCase().includes("not implemented")) {
        console.log(`RPC ${rpcUrl} не поддерживает отправку транзакций: ${errorMessage}`);
        throw new Error("Метод отправки транзакций не поддерживается");
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
      const errorMessage = error.response.data.error.message || "";
      if (errorMessage.toLowerCase().includes("method not found") || 
          errorMessage.toLowerCase().includes("method not supported") ||
          errorMessage.toLowerCase().includes("not implemented")) {
        console.log(`RPC ${rpcUrl} не поддерживает отправку транзакций: ${errorMessage}`);
        throw new Error("Метод отправки транзакций не поддерживается");
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
      jsonrpc: "2.0",
      method: method,
      params: params,
      id: 1
    }, {
      headers: {
        "Content-Type": "application/json"
      },
      timeout: REQUEST_TIMEOUT
    });
    
    // Проверяем наличие ошибки о неподдерживаемом методе
    if (response.data.error) {
      const errorMessage = response.data.error.message || "";
      if (errorMessage.toLowerCase().includes("method not found") || 
          errorMessage.toLowerCase().includes("method not supported") ||
          errorMessage.toLowerCase().includes("not implemented")) {
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
    if (method === "eth_getBalance") {
      if (!response.data.result || typeof response.data.result !== "string" || !response.data.result.startsWith("0x")) {
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
      const errorMessage = error.response.data.error.message || "";
      if (errorMessage.toLowerCase().includes("method not found") || 
          errorMessage.toLowerCase().includes("method not supported") ||
          errorMessage.toLowerCase().includes("not implemented")) {
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
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
      id: 1
    }, {
      headers: {
        "Content-Type": "application/json"
      },
      timeout: REQUEST_TIMEOUT
    });
    
    if (response.data.error) {
      throw new Error(`RPC вернул ошибку: ${response.data.error.message}`);
    }
    
    if (!response.data.result || typeof response.data.result !== "string" || !response.data.result.startsWith("0x")) {
      throw new Error("Некорректный ответ от RPC");
    }
    
    console.log(`RPC доступен: ${rpcUrl}`);
    return true;
  } catch (error) {
    console.error(`Ошибка при проверке доступности ${rpcUrl}:`, error.message);
    throw error;
  }
}

// Функция для комплексного тестирования RPC
async function testRpc(rpcUrl, checkTx = false, checkMethods = false) {
  console.log(`Комплексное тестирование RPC: ${rpcUrl}, checkTx=${checkTx}, checkMethods=${checkMethods}`);
  
  try {
    // Базовая проверка доступности
    await testRpcAvailability(rpcUrl);
    
    // Проверка поддержки транзакций, если требуется
    if (checkTx) {
      await testRpcTransactionSupport(rpcUrl);
    }
    
    // Проверка поддержки основных методов, если требуется
    if (checkMethods) {
      await testRpcMethodSupport(rpcUrl, "eth_getBalance", ["0x0000000000000000000000000000000000000000", "latest"]);
      await testRpcMethodSupport(rpcUrl, "eth_gasPrice");
      await testRpcMethodSupport(rpcUrl, "eth_estimateGas", [{
        from: "0x0000000000000000000000000000000000000000",
        to: "0x0000000000000000000000000000000000000000",
        value: "0x1"
      }]);
    }
    
    console.log(`RPC ${rpcUrl} успешно прошел все тесты`);
    return true;
  } catch (error) {
    console.error(`RPC ${rpcUrl} не прошел тесты:`, error.message);
    throw error;
  }
}

// Функция для получения списка доступных RPC для chain_id
function getAvailableRpcs(chainId, rpcList) {
  const allRpcs = rpcList[chainId] || [];
  
  // Фильтруем RPC, которые недавно были помечены как неработающие
  const availableRpcs = allRpcs.filter(rpc => {
    const failedInfo = failedRpcs.get(rpc);
    if (failedInfo && failedInfo.timestamp > Date.now() - RETRY_TIMEOUT) {
      console.log(`RPC ${rpc} временно исключен (не работал ${new Date(failedInfo.timestamp).toISOString()})`);
      return false;
    }
    return true;
  });
  
  console.log(`Найдено ${availableRpcs.length} доступных RPC для chain_id=${chainId}`);
  return availableRpcs;
}

// Функция для выбора RPC для запроса
async function selectRpc(chainId) {
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
    if (!privateKey.startsWith("0x")) {
      privateKey = "0x" + privateKey;
    }
    
    const wallet = new ethers.Wallet(privateKey);
    return wallet.address;
  } catch (error) {
    throw new Error(`Ошибка при получении адреса из приватного ключа: ${error.message}`);
  }
}

// Функция для получения адреса из mnemonic
function getAddressFromMnemonic(mnemonic) {
  try {
    // Используем ethers.HDNodeWallet.fromMnemonic для ethers v6+
    const wallet = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(mnemonic));
    return wallet.address;
  } catch (error) {
    throw new Error(`Ошибка при получении адреса из мнемоники: ${error.message}`);
  }
}

// Функция для получения баланса адреса
async function getBalance(address, rpcUrl) {
  try {
    const response = await axios.post(rpcUrl, {
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
      id: 1
    }, {
      headers: {
        "Content-Type": "application/json"
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
      jsonrpc: "2.0",
      method: "eth_gasPrice",
      params: [],
      id: 1
    }, {
      headers: {
        "Content-Type": "application/json"
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
      jsonrpc: "2.0",
      method: "eth_estimateGas",
      params: [{
        from: from,
        to: to,
        value: value
      }],
      id: 1
    }, {
      headers: {
        "Content-Type": "application/json"
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
    const cachedRates = currencyRates.get("rates");
    if (cachedRates && cachedRates.timestamp > Date.now() - CURRENCY_CACHE_TIMEOUT) {
      console.log("Курсы валют получены из кэша");
      return cachedRates.rates;
    }
    
    const response = await axios.get("https://ratios.wallet.brave.com/v2/relative/provider/coingecko/eth,scroll,linea,moonbeam,aurora,mantle,okx,core,unichain,matic,bnb,op,base,fantom,gnosis,avax,polygon,arbitrum,cronos,zksync,core,pulsechain,blast,moonriver,celo/usd/live", {
      headers: {
        "x-brave-key": "qztbjzBqJueQZLFkwTTJrieu8Vw3789u"
      },
      timeout: 10000
    });
    
    if (!response.data || !response.data.payload) {
      throw new Error("Некорректный ответ от API курсов валют");
    }
    
    // Сохраняем результат в кэш
    currencyRates.set("rates", {
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
  // Используем ethers.toBigInt для ethers v6+
  return ethers.toBigInt(hex).toString();
}

// Функция для конвертации decimal в hex
function decimalToHex(decimal) {
  // Используем ethers.toBeHex для ethers v6+
  return ethers.toBeHex(ethers.toBigInt(decimal));
}

// Функция для конвертации wei в ether
function weiToEther(wei) {
  // Используем ethers.formatEther для ethers v6+
  return ethers.formatEther(wei);
}

// Функция для конвертации ether в wei
function etherToWei(ether) {
  // Используем ethers.parseEther для ethers v6+
  return ethers.parseEther(ether).toString();
}

// Функция для отправки транзакции
async function sendTransaction(privateKey, to, value, gasPrice, rpcUrl) {
  try {
    // Создаем провайдер и кошелек
    // Используем ethers.JsonRpcProvider для ethers v6+
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Создаем транзакцию
    const tx = {
      to: to,
      value: ethers.toBigInt(value) // Используем ethers.toBigInt
    };
    
    // Если указана цена газа, добавляем ее
    if (gasPrice) {
      tx.gasPrice = ethers.toBigInt(gasPrice); // Используем ethers.toBigInt
    }
    
    // Отправляем транзакцию
    const txResponse = await wallet.sendTransaction(tx);
    
    // Ждем подтверждения
    const receipt = await txResponse.wait();
    
    return {
      hash: txResponse.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status === 1 ? "success" : "failed"
    };
  } catch (error) {
    throw new Error(`Ошибка при отправке транзакции: ${error.message}`);
  }
}

// Swagger конфигурация
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "RPC API",
      version: "1.0.0",
      description: "API для работы с RPC и блокчейн-сетями",
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: "Локальный сервер",
      },
      {
        url: "https://rpcmy2new-production.up.railway.app", // Добавляем продакшн URL
        description: "Продакшн сервер (Railway)",
      },
    ],
  },
  apis: ["./server.js"], // Путь к файлам с JSDoc комментариями
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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
app.get("/rpc", async (req, res) => {
  const chainId = req.query.chain_id;
  const checkTx = req.query.check_tx === "true"; // Параметр для проверки поддержки транзакций
  const checkMethods = req.query.check_methods === "true"; // Параметр для проверки поддержки методов
  
  console.log(`Запрос /rpc для chain_id=${chainId}, checkTx=${checkTx}, checkMethods=${checkMethods}`);
  
  if (!chainId) {
    console.log("Ошибка: chain_id не указан");
    return res.status(400).json({ error: "Необходимо указать chain_id" });
  }
  
  // Нормализуем chain_id (поддержка алиасов)
  const normalizedChainId = normalizeChainId(chainId);
  
  // Получаем объединенный список RPC с учетом приоритетов
  const mergedRpcList = mergeRpcLists();
  
  // Получаем доступные RPC
  const availableRpcs = getAvailableRpcs(normalizedChainId, mergedRpcList);
  
  if (availableRpcs.length === 0) {
    console.log(`Ошибка: нет доступных RPC для chain_id=${normalizedChainId}`);
    return res.status(503).json({ error: "Нет доступных RPC для данной сети" });
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
      return res.status(503).json({ error: "Все доступные RPC недоступны" });
    } else {
      console.log(`Ошибка: все доступные RPC недоступны для chain_id=${normalizedChainId}`);
      return res.status(503).json({ error: "Все доступные RPC недоступны" });
    }
  }
});

/**
 * @swagger
 * /rpc_d:
 *   all:
 *     summary: Прокси для RPC запросов (поддерживает GET и POST)
 *     description: Перенаправляет RPC запросы к выбранному узлу для указанной сети. Поддерживает все стандартные RPC методы.
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас (например, 1, eth, ethereum)
 *     requestBody:
 *       description: Тело RPC запроса в формате JSON
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jsonrpc:
 *                 type: string
 *                 example: "2.0"
 *               method:
 *                 type: string
 *                 example: "eth_getBalance"
 *               params:
 *                 type: array
 *                 example: ["0xCC2A9a398219D3c8Ab006820bc7C025118a295Ed", "latest"]
 *               id:
 *                 type: integer
 *                 example: 1
 *     responses:
 *       200:
 *         description: Успешный ответ от RPC узла
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jsonrpc:
 *                   type: string
 *                 id:
 *                   type: integer
 *                 result:
 *                   type: string
 *       400:
 *         description: Ошибка в запросе (например, не указан chain_id)
 *       503:
 *         description: Нет доступных RPC для указанной сети
 */
app.all("/rpc_d", async (req, res) => {
  const chainId = req.query.chain_id;
  
  console.log(`Запрос /rpc_d для chain_id=${chainId}, метод=${req.method}`);
  console.log("Тело запроса:", JSON.stringify(req.body));
  
  if (!chainId) {
    console.log("Ошибка: chain_id не указан");
    return res.status(400).json({ error: "Необходимо указать chain_id" });
  }
  
  // Нормализуем chain_id (поддержка алиасов)
  const normalizedChainId = normalizeChainId(chainId);
  
  // Получаем объединенный список RPC с учетом приоритетов
  const mergedRpcList = mergeRpcLists();
  
  // Получаем доступные RPC
  const availableRpcs = getAvailableRpcs(normalizedChainId, mergedRpcList);
  
  if (availableRpcs.length === 0) {
    console.log(`Ошибка: нет доступных RPC для chain_id=${normalizedChainId}`);
    return res.status(503).json({ error: "Нет доступных RPC для данной сети" });
  }
  
  // Получаем метод из тела запроса для проверки поддержки
  let requestMethod = "eth_blockNumber"; // По умолчанию
  let requestParams = [];
  
  try {
    if (req.body && req.body.method) {
      requestMethod = req.body.method;
      requestParams = req.body.params || [];
      console.log(`Запрошенный метод: ${requestMethod}, параметры:`, requestParams);
    }
  } catch (e) {
    console.error("Ошибка при получении метода из тела запроса:", e.message);
  }
  
  // Выбираем первый RPC из доступных (с учетом приоритета)
  const selectedRpc = availableRpcs[0];
  console.log(`Выбран RPC для прокси: ${selectedRpc}`);
  
  try {
    // Базовая проверка доступности
    await testRpcAvailability(selectedRpc);
    
    // Получаем тело запроса и заголовки
    const requestBody = req.body;
    const contentType = req.headers["content-type"] || "application/json";
    
    console.log(`Проксирование запроса к ${selectedRpc}...`);
    
    // Проксируем запрос к выбранному RPC
    const proxyResponse = await axios({
      method: req.method,
      url: selectedRpc,
      data: requestBody,
      headers: {
        "Content-Type": contentType
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
          const contentType = req.headers["content-type"] || "application/json";
          
          console.log(`Проксирование запроса к ${nextRpc}...`);
          
          // Проксируем запрос к новому выбранному RPC
          const proxyResponse = await axios({
            method: req.method,
            url: nextRpc,
            data: requestBody,
            headers: {
              "Content-Type": contentType
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
      console.log(`Ошибка: все доступные RPC недоступны для проксирования (chain_id=${normalizedChainId})`);
      return res.status(503).json({ error: "Все доступные RPC недоступны для проксирования" });
    } else {
      console.log(`Ошибка: все доступные RPC недоступны для проксирования (chain_id=${normalizedChainId})`);
      return res.status(503).json({ error: "Все доступные RPC недоступны для проксирования" });
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
 *         description: Адрес кошелька
 *       - in: query
 *         name: private_key
 *         schema:
 *           type: string
 *         description: Приватный ключ кошелька
 *       - in: query
 *         name: mnemonic
 *         schema:
 *           type: string
 *         description: Мнемоническая фраза кошелька
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас (например, 1, eth, ethereum)
 *     responses:
 *       200:
 *         description: Успешный ответ с балансом
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address:
 *                   type: string
 *                 balance_wei:
 *                   type: string
 *                 balance_ether:
 *                   type: string
 *       400:
 *         description: Ошибка в запросе
 *       503:
 *         description: Нет доступных RPC
 */
app.get("/balance", async (req, res) => {
  const { address, private_key, mnemonic, chain_id } = req.query;
  
  console.log(`Запрос /balance для chain_id=${chain_id}, address=${address}, private_key=${private_key ? "***" : "-"}, mnemonic=${mnemonic ? "***" : "-"}`);
  
  if (!chain_id) {
    console.log("Ошибка: chain_id не указан");
    return res.status(400).json({ error: "Необходимо указать chain_id" });
  }
  
  if (!address && !private_key && !mnemonic) {
    console.log("Ошибка: не указан адрес, приватный ключ или мнемоника");
    return res.status(400).json({ error: "Необходимо указать address, private_key или mnemonic" });
  }
  
  let targetAddress;
  try {
    if (address) {
      // Используем ethers.isAddress для ethers v6+
      if (!ethers.isAddress(address)) {
        console.log(`Ошибка: некорректный адрес ${address}`);
        return res.status(400).json({ error: "Некорректный адрес" });
      }
      targetAddress = address;
    } else if (private_key) {
      targetAddress = getAddressFromPrivateKey(private_key);
    } else if (mnemonic) {
      targetAddress = getAddressFromMnemonic(mnemonic);
    }
    console.log(`Определен адрес: ${targetAddress}`);
  } catch (error) {
    console.error("Ошибка при определении адреса:", error.message);
    return res.status(400).json({ error: error.message });
  }
  
  try {
    // Выбираем RPC
    const rpcUrl = await selectRpc(chain_id);
    console.log(`Выбран RPC для баланса: ${rpcUrl}`);
    
    // Получаем баланс
    const balanceWei = await getBalance(targetAddress, rpcUrl);
    const balanceEther = weiToEther(balanceWei);
    
    console.log(`Баланс для ${targetAddress}: ${balanceEther} ETH`);
    
    return res.json({
      address: targetAddress,
      balance_wei: balanceWei,
      balance_ether: balanceEther
    });
  } catch (error) {
    console.error("Ошибка при получении баланса:", error.message);
    return res.status(503).json({ error: error.message });
  }
});

/**
 * @swagger
 * /eth_to_usd:
 *   get:
 *     summary: Конвертировать ETH в USD
 *     parameters:
 *       - in: query
 *         name: amount_eth
 *         required: true
 *         schema:
 *           type: number
 *         description: Сумма в ETH
 *     responses:
 *       200:
 *         description: Успешный ответ с суммой в USD
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 amount_eth:
 *                   type: number
 *                 eth_usd_rate:
 *                   type: number
 *                 amount_usd:
 *                   type: number
 *       500:
 *         description: Ошибка при получении курса
 */
app.get("/eth_to_usd", async (req, res) => {
  const amountEth = parseFloat(req.query.amount_eth);
  
  console.log(`Запрос /eth_to_usd для amount_eth=${amountEth}`);
  
  if (isNaN(amountEth)) {
    console.log("Ошибка: некорректная сумма ETH");
    return res.status(400).json({ error: "Некорректная сумма ETH" });
  }
  
  try {
    const rates = await getCurrencyRates();
    const ethRate = rates.find(rate => rate.symbol === "ETH");
    
    if (!ethRate || !ethRate.rate) {
      console.log("Ошибка: не удалось получить курс ETH/USD");
      throw new Error("Не удалось получить курс ETH/USD");
    }
    
    const ethUsdRate = ethRate.rate;
    const amountUsd = amountEth * ethUsdRate;
    
    console.log(`Курс ETH/USD: ${ethUsdRate}, сумма в USD: ${amountUsd}`);
    
    return res.json({
      amount_eth: amountEth,
      eth_usd_rate: ethUsdRate,
      amount_usd: amountUsd
    });
  } catch (error) {
    console.error("Ошибка при конвертации ETH в USD:", error.message);
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
 *         description: ID блокчейн-сети или алиас (например, 1, eth, ethereum)
 *     responses:
 *       200:
 *         description: Успешный ответ с ценой газа
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 gas_price_wei:
 *                   type: string
 *                 gas_price_gwei:
 *                   type: string
 *       400:
 *         description: Ошибка в запросе
 *       503:
 *         description: Нет доступных RPC
 */
app.get("/gas_price", async (req, res) => {
  const chainId = req.query.chain_id;
  
  console.log(`Запрос /gas_price для chain_id=${chainId}`);
  
  if (!chainId) {
    console.log("Ошибка: chain_id не указан");
    return res.status(400).json({ error: "Необходимо указать chain_id" });
  }
  
  try {
    // Выбираем RPC
    const rpcUrl = await selectRpc(chainId);
    console.log(`Выбран RPC для цены газа: ${rpcUrl}`);
    
    // Получаем цену газа
    const gasPriceWei = await getGasPrice(rpcUrl);
    // Используем ethers.formatUnits для ethers v6+
    const gasPriceGwei = ethers.formatUnits(gasPriceWei, "gwei");
    
    console.log(`Цена газа: ${gasPriceGwei} Gwei`);
    
    return res.json({
      gas_price_wei: gasPriceWei,
      gas_price_gwei: gasPriceGwei
    });
  } catch (error) {
    console.error("Ошибка при получении цены газа:", error.message);
    return res.status(503).json({ error: error.message });
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
 *         name: value_ether
 *         required: true
 *         schema:
 *           type: number
 *         description: Сумма перевода в ETH
 *       - in: query
 *         name: chain_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас (например, 1, eth, ethereum)
 *     responses:
 *       200:
 *         description: Успешный ответ с оценкой газа
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 gas_estimate_hex:
 *                   type: string
 *                 gas_estimate_decimal:
 *                   type: string
 *       400:
 *         description: Ошибка в запросе
 *       503:
 *         description: Нет доступных RPC
 */
app.get("/gas_estimate", async (req, res) => {
  const { from, to, value_ether, chain_id } = req.query;
  
  console.log(`Запрос /gas_estimate для chain_id=${chain_id}, from=${from}, to=${to}, value_ether=${value_ether}`);
  
  if (!chain_id || !from || !to || value_ether === undefined) {
    console.log("Ошибка: не все параметры указаны");
    return res.status(400).json({ error: "Необходимо указать chain_id, from, to, value_ether" });
  }
  
  // Используем ethers.isAddress для ethers v6+
  if (!ethers.isAddress(from) || !ethers.isAddress(to)) {
    console.log("Ошибка: некорректный адрес отправителя или получателя");
    return res.status(400).json({ error: "Некорректный адрес отправителя или получателя" });
  }
  
  const valueEtherNum = parseFloat(value_ether);
  if (isNaN(valueEtherNum)) {
    console.log("Ошибка: некорректная сумма ETH");
    return res.status(400).json({ error: "Некорректная сумма ETH" });
  }
  
  try {
    // Выбираем RPC
    const rpcUrl = await selectRpc(chain_id);
    console.log(`Выбран RPC для оценки газа: ${rpcUrl}`);
    
    // Конвертируем ETH в Wei
    const valueWei = etherToWei(value_ether);
    
    // Оцениваем газ
    const gasEstimateHex = await estimateGas(from, to, valueWei, rpcUrl);
    const gasEstimateDecimal = hexToDecimal(gasEstimateHex);
    
    console.log(`Оценка газа: ${gasEstimateDecimal}`);
    
    return res.json({
      gas_estimate_hex: gasEstimateHex,
      gas_estimate_decimal: gasEstimateDecimal
    });
  } catch (error) {
    console.error("Ошибка при оценке газа:", error.message);
    return res.status(503).json({ error: error.message });
  }
});

/**
 * @swagger
 * /gas_re:
 *   get:
 *     summary: Рассчитать максимальную сумму для вывода с учетом газа
 *     parameters:
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Адрес кошелька
 *       - in: query
 *         name: private_key
 *         schema:
 *           type: string
 *         description: Приватный ключ кошелька
 *       - in: query
 *         name: mnemonic
 *         schema:
 *           type: string
 *         description: Мнемоническая фраза кошелька
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
 *         description: ID блокчейн-сети или алиас (например, 1, eth, ethereum)
 *     responses:
 *       200:
 *         description: Успешный ответ с максимальной суммой
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address:
 *                   type: string
 *                 balance_wei:
 *                   type: string
 *                 gas_price_wei:
 *                   type: string
 *                 gas_limit:
 *                   type: string
 *                 gas_cost_wei:
 *                   type: string
 *                 max_send_amount_wei:
 *                   type: string
 *                 max_send_amount_ether:
 *                   type: string
 *       400:
 *         description: Ошибка в запросе
 *       503:
 *         description: Нет доступных RPC или недостаточно средств
 */
app.get("/gas_re", async (req, res) => {
  const { address, private_key, mnemonic, to, chain_id } = req.query;
  
  console.log(`Запрос /gas_re для chain_id=${chain_id}, address=${address}, private_key=${private_key ? "***" : "-"}, mnemonic=${mnemonic ? "***" : "-"}, to=${to}`);
  
  if (!chain_id || !to) {
    console.log("Ошибка: не указан chain_id или to");
    return res.status(400).json({ error: "Необходимо указать chain_id и to" });
  }
  
  if (!address && !private_key && !mnemonic) {
    console.log("Ошибка: не указан адрес, приватный ключ или мнемоника");
    return res.status(400).json({ error: "Необходимо указать address, private_key или mnemonic" });
  }
  
  // Используем ethers.isAddress для ethers v6+
  if (!ethers.isAddress(to)) {
    console.log(`Ошибка: некорректный адрес получателя ${to}`);
    return res.status(400).json({ error: "Некорректный адрес получателя" });
  }
  
  let targetAddress;
  try {
    if (address) {
      // Используем ethers.isAddress для ethers v6+
      if (!ethers.isAddress(address)) {
        console.log(`Ошибка: некорректный адрес ${address}`);
        return res.status(400).json({ error: "Некорректный адрес" });
      }
      targetAddress = address;
    } else if (private_key) {
      targetAddress = getAddressFromPrivateKey(private_key);
    } else if (mnemonic) {
      targetAddress = getAddressFromMnemonic(mnemonic);
    }
    console.log(`Определен адрес отправителя: ${targetAddress}`);
  } catch (error) {
    console.error("Ошибка при определении адреса отправителя:", error.message);
    return res.status(400).json({ error: error.message });
  }
  
  try {
    // Выбираем RPC
    const rpcUrl = await selectRpc(chain_id);
    console.log(`Выбран RPC для расчета газа: ${rpcUrl}`);
    
    // Получаем баланс
    const balanceWei = await getBalance(targetAddress, rpcUrl);
    const balanceBigInt = ethers.toBigInt(balanceWei); // Используем ethers.toBigInt
    
    // Получаем цену газа
    const gasPriceWei = await getGasPrice(rpcUrl);
    const gasPriceBigInt = ethers.toBigInt(gasPriceWei); // Используем ethers.toBigInt
    
    // Оцениваем газ (используем стандартный лимит для простого перевода ETH)
    const gasLimit = ethers.toBigInt(21000); // Используем ethers.toBigInt
    
    // Рассчитываем стоимость газа
    const gasCostWei = gasPriceBigInt * gasLimit;
    
    // Рассчитываем максимальную сумму для отправки
    if (balanceBigInt <= gasCostWei) {
      console.log("Ошибка: недостаточно средств для оплаты газа");
      return res.status(503).json({ error: "Недостаточно средств для оплаты газа" });
    }
    
    const maxSendAmountWei = balanceBigInt - gasCostWei;
    const maxSendAmountEther = weiToEther(maxSendAmountWei.toString());
    
    console.log(`Баланс: ${weiToEther(balanceWei)} ETH, Стоимость газа: ${weiToEther(gasCostWei.toString())} ETH, Макс. сумма: ${maxSendAmountEther} ETH`);
    
    return res.json({
      address: targetAddress,
      balance_wei: balanceWei,
      gas_price_wei: gasPriceWei,
      gas_limit: gasLimit.toString(),
      gas_cost_wei: gasCostWei.toString(),
      max_send_amount_wei: maxSendAmountWei.toString(),
      max_send_amount_ether: maxSendAmountEther
    });
  } catch (error) {
    console.error("Ошибка при расчете максимальной суммы:", error.message);
    return res.status(503).json({ error: error.message });
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
 *         description: Приватный ключ кошелька
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
 *         description: ID блокчейн-сети или алиас (например, 1, eth, ethereum)
 *     responses:
 *       200:
 *         description: Успешный ответ с хешем транзакции
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hash:
 *                   type: string
 *                 blockNumber:
 *                   type: number
 *                 gasUsed:
 *                   type: string
 *                 status:
 *                   type: string
 *       400:
 *         description: Ошибка в запросе
 *       503:
 *         description: Нет доступных RPC или недостаточно средств
 */
app.get("/send_transaction", async (req, res) => {
  const { private_key, to, chain_id } = req.query;
  
  console.log(`Запрос /send_transaction для chain_id=${chain_id}, private_key=${private_key ? "***" : "-"}, to=${to}`);
  
  if (!chain_id || !private_key || !to) {
    console.log("Ошибка: не все параметры указаны");
    return res.status(400).json({ error: "Необходимо указать chain_id, private_key, to" });
  }
  
  // Используем ethers.isAddress для ethers v6+
  if (!ethers.isAddress(to)) {
    console.log(`Ошибка: некорректный адрес получателя ${to}`);
    return res.status(400).json({ error: "Некорректный адрес получателя" });
  }
  
  let targetAddress;
  try {
    targetAddress = getAddressFromPrivateKey(private_key);
    console.log(`Определен адрес отправителя: ${targetAddress}`);
  } catch (error) {
    console.error("Ошибка при определении адреса отправителя:", error.message);
    return res.status(400).json({ error: error.message });
  }
  
  try {
    // Выбираем RPC
    const rpcUrl = await selectRpc(chain_id);
    console.log(`Выбран RPC для отправки транзакции: ${rpcUrl}`);
    
    // Получаем баланс
    const balanceWei = await getBalance(targetAddress, rpcUrl);
    const balanceBigInt = ethers.toBigInt(balanceWei); // Используем ethers.toBigInt
    
    // Получаем цену газа
    const gasPriceWei = await getGasPrice(rpcUrl);
    const gasPriceBigInt = ethers.toBigInt(gasPriceWei); // Используем ethers.toBigInt
    
    // Оцениваем газ (используем стандартный лимит для простого перевода ETH)
    const gasLimit = ethers.toBigInt(21000); // Используем ethers.toBigInt
    
    // Рассчитываем стоимость газа
    const gasCostWei = gasPriceBigInt * gasLimit;
    
    // Рассчитываем максимальную сумму для отправки
    if (balanceBigInt <= gasCostWei) {
      console.log("Ошибка: недостаточно средств для оплаты газа");
      return res.status(503).json({ error: "Недостаточно средств для оплаты газа" });
    }
    
    const maxSendAmountWei = balanceBigInt - gasCostWei;
    
    console.log(`Отправка ${weiToEther(maxSendAmountWei.toString())} ETH на адрес ${to}`);
    
    // Отправляем транзакцию
    const txResult = await sendTransaction(private_key, to, maxSendAmountWei.toString(), gasPriceWei, rpcUrl);
    
    console.log(`Транзакция успешно отправлена: ${txResult.hash}`);
    
    return res.json(txResult);
  } catch (error) {
    console.error("Ошибка при отправке транзакции:", error.message);
    return res.status(503).json({ error: error.message });
  }
});

/**
 * @swagger
 * /aliases:
 *   get:
 *     summary: Получить список алиасов для указанного chain_id или все алиасы
 *     parameters:
 *       - in: query
 *         name: chain_id
 *         schema:
 *           type: string
 *         description: ID блокчейн-сети или алиас (если не указан, возвращает все алиасы)
 *     responses:
 *       200:
 *         description: Успешный ответ со списком алиасов
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: Объект, где ключ - chain_id, значение - массив алиасов
 *       404:
 *         description: Алиасы для указанного chain_id не найдены
 */
app.get("/aliases", (req, res) => {
  const chainId = req.query.chain_id;
  
  if (chainId) {
    // Нормализуем chain_id
    const normalizedChainId = normalizeChainId(chainId);
    
    // Ищем алиасы для конкретного chain_id
    const aliases = chainIdToAliasesMap[normalizedChainId];
    
    if (aliases) {
      console.log(`Возвращаем алиасы для chain_id=${normalizedChainId}:`, aliases);
      return res.json({ [normalizedChainId]: aliases });
    } else {
      console.log(`Алиасы для chain_id=${normalizedChainId} не найдены`);
      return res.status(404).json({ error: `Алиасы для chain_id ${normalizedChainId} не найдены` });
    }
  } else {
    // Возвращаем все алиасы
    console.log("Возвращаем все алиасы");
    return res.json(chainIdToAliasesMap);
  }
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Проверка работоспособности сервиса
 *     responses:
 *       200:
 *         description: Сервис работает
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: OK
 */
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Запускаем загрузку данных RPC при старте
loadRpcDataFromExternalSources().then(() => {
  // Запускаем сервер после загрузки данных
  app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
  });
}).catch(err => {
  console.error("Не удалось загрузить данные RPC при запуске, сервер может работать некорректно:", err.message);
  // Все равно запускаем сервер, но с предупреждением
  app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT} (с ошибкой загрузки RPC)`);
  });
});

// Периодическая проверка всех RPC (необязательно)
// setInterval(async () => {
//   console.log("Запуск периодической проверки всех RPC...");
//   const allRpcs = Object.values(mergeRpcLists()).flat();
//   for (const rpc of allRpcs) {
//     try {
//       await testRpcAvailability(rpc);
//       // Если RPC снова заработал, удаляем его из списка неработающих
//       if (failedRpcs.has(rpc)) {
//         failedRpcs.delete(rpc);
//         console.log(`RPC ${rpc} снова доступен`);
//       }
//     } catch (error) {
//       // Если RPC все еще не работает, обновляем время ошибки
//       failedRpcs.set(rpc, { 
//         timestamp: Date.now(),
//         error: error.message
//       });
//       console.error(`RPC ${rpc} все еще недоступен:`, error.message);
//     }
//   }
//   console.log("Периодическая проверка RPC завершена");
// }, CHECK_INTERVAL);

