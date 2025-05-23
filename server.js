const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Загружаем список RPC-узлов из JSON-файла или из переменной окружения
let rpcList;
try {
  // Пробуем загрузить из файла
  rpcList = JSON.parse(fs.readFileSync('./rpcs.json', 'utf8'));
} catch (err) {
  // Если файл не найден, пробуем загрузить из переменной окружения
  if (process.env.RPC_LIST) {
    try {
      rpcList = JSON.parse(process.env.RPC_LIST);
    } catch (parseErr) {
      console.error('Ошибка парсинга RPC_LIST:', parseErr);
      process.exit(1);
    }
  } else {
    console.error('Не удалось загрузить список RPC. Ни файл rpcs.json, ни переменная окружения RPC_LIST не найдены.');
    process.exit(1);
  }
}

// Кэш для хранения нерабочих RPC с временем их последней проверки
const failedRpcs = new Map();
const RETRY_TIMEOUT = parseInt(process.env.RETRY_TIMEOUT) || 5 * 60 * 1000; // 5 минут до повторной проверки
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 15 * 60 * 1000; // Интервал проверки всех RPC (15 минут)
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT) || 3000; // Таймаут запроса (3 секунды)

app.get('/rpc', async (req, res) => {
  const chainId = req.query.chain_id;
  
  if (!chainId) {
    return res.status(400).json({ error: 'Необходимо указать chain_id' });
  }
  
  // Проверяем, есть ли RPC для запрошенной сети
  if (!rpcList[chainId] || rpcList[chainId].length === 0) {
    return res.status(404).json({ error: 'RPC для данной сети не найдены' });
  }
  
  // Фильтруем только рабочие RPC или те, которые стоит проверить снова
  const availableRpcs = rpcList[chainId].filter(rpc => {
    const failedInfo = failedRpcs.get(rpc);
    return !failedInfo || (Date.now() - failedInfo.timestamp > RETRY_TIMEOUT);
  });
  
  if (availableRpcs.length === 0) {
    return res.status(503).json({ error: 'Нет доступных RPC для данной сети' });
  }
  
  // Выбираем случайный RPC из доступных
  const randomIndex = Math.floor(Math.random() * availableRpcs.length);
  const selectedRpc = availableRpcs[randomIndex];
  
  try {
    // Тестируем RPC
    const response = await testRpc(selectedRpc);
    
    // Если тест успешен, перенаправляем запрос
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
      const remainingRpcs = availableRpcs.filter(rpc => rpc !== selectedRpc);
      const newRandomIndex = Math.floor(Math.random() * remainingRpcs.length);
      const newSelectedRpc = remainingRpcs[newRandomIndex];
      
      try {
        await testRpc(newSelectedRpc);
        return res.json({ rpc: newSelectedRpc });
      } catch (error) {
        failedRpcs.set(newSelectedRpc, { 
          timestamp: Date.now(),
          error: error.message
        });
        return res.status(503).json({ error: 'Все доступные RPC недоступны' });
      }
    } else {
      return res.status(503).json({ error: 'Все доступные RPC недоступны' });
    }
  }
});

// Функция для тестирования RPC
async function testRpc(rpcUrl) {
  // Простой тестовый запрос - можно настроить под конкретную сеть
  // Для Ethereum это может быть eth_blockNumber
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
    throw new Error(`RPC вернул ошибку: ${response.data.error.message}`);
  }
  
  return response.data;
}

// Периодическая проверка всех RPC
function scheduleRpcCheck() {
  setInterval(() => {
    console.log('Запуск проверки всех RPC...');
    Object.keys(rpcList).forEach(chainId => {
      rpcList[chainId].forEach(async (rpc) => {
        try {
          await testRpc(rpc);
          // Если проверка прошла успешно, удаляем из списка неработающих
          if (failedRpcs.has(rpc)) {
            failedRpcs.delete(rpc);
            console.log(`RPC восстановлен: ${rpc}`);
          }
        } catch (error) {
          failedRpcs.set(rpc, { 
            timestamp: Date.now(),
            error: error.message
          });
          console.log(`RPC не работает: ${rpc} - ${error.message}`);
        }
      });
    });
  }, CHECK_INTERVAL);
}

// Обработка ошибок и необработанных исключений
process.on('uncaughtException', (error) => {
  console.error('Необработанное исключение:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Необработанное отклонение Promise:', reason);
});

// Добавляем проверку состояния для Railway
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  // Запускаем периодическую проверку RPC
  scheduleRpcCheck();
});