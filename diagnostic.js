// Скрипт для диагностики окружения Railway
console.log('=== ДИАГНОСТИКА ОКРУЖЕНИЯ RAILWAY ===');

// Вывод версий Node.js и npm
console.log('\n=== ВЕРСИИ ===');
console.log('Node.js версия:', process.version);
try {
  const { execSync } = require('child_process');
  const npmVersion = execSync('npm -v').toString().trim();
  console.log('npm версия:', npmVersion);
} catch (error) {
  console.log('Ошибка при получении версии npm:', error.message);
}

// Вывод переменных окружения
console.log('\n=== ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ===');
console.log(JSON.stringify(process.env, null, 2));

// Проверка наличия и версии ethers
console.log('\n=== ПРОВЕРКА ETHERS ===');
try {
  const ethers = require('ethers');
  console.log('ethers версия:', ethers.version || 'установлен, но версия неизвестна');
  console.log('ethers путь:', require.resolve('ethers'));
  console.log('ethers utils доступен:', !!ethers.utils);
  if (ethers.utils) {
    console.log('ethers.utils.isAddress доступен:', typeof ethers.utils.isAddress === 'function');
  }
} catch (error) {
  console.log('Ошибка при импорте ethers:', error.message);
}

// Проверка структуры node_modules
console.log('\n=== СТРУКТУРА NODE_MODULES ===');
try {
  const fs = require('fs');
  const path = require('path');
  
  // Проверяем наличие директории node_modules
  const nodeModulesPath = path.resolve('./node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    console.log('Директория node_modules существует');
    
    // Проверяем наличие директории ethers
    const ethersPath = path.resolve('./node_modules/ethers');
    if (fs.existsSync(ethersPath)) {
      console.log('Директория ethers существует');
      
      // Выводим содержимое директории ethers
      const ethersFiles = fs.readdirSync(ethersPath);
      console.log('Содержимое директории ethers:', ethersFiles);
      
      // Проверяем наличие package.json для ethers
      const ethersPackageJsonPath = path.resolve('./node_modules/ethers/package.json');
      if (fs.existsSync(ethersPackageJsonPath)) {
        const ethersPackageJson = require(ethersPackageJsonPath);
        console.log('ethers package.json версия:', ethersPackageJson.version);
      } else {
        console.log('ethers package.json не найден');
      }
    } else {
      console.log('Директория ethers не существует');
    }
  } else {
    console.log('Директория node_modules не существует');
  }
} catch (error) {
  console.log('Ошибка при проверке структуры node_modules:', error.message);
}

// Проверка package.json и package-lock.json
console.log('\n=== PACKAGE.JSON И PACKAGE-LOCK.JSON ===');
try {
  const fs = require('fs');
  
  // Проверяем package.json
  if (fs.existsSync('./package.json')) {
    const packageJson = require('./package.json');
    console.log('package.json dependencies:', packageJson.dependencies);
    console.log('package.json devDependencies:', packageJson.devDependencies);
  } else {
    console.log('package.json не найден');
  }
  
  // Проверяем package-lock.json
  if (fs.existsSync('./package-lock.json')) {
    console.log('package-lock.json существует');
    // Не выводим содержимое, так как оно может быть очень большим
  } else {
    console.log('package-lock.json не найден');
  }
} catch (error) {
  console.log('Ошибка при проверке package.json и package-lock.json:', error.message);
}

// Проверка кеша npm
console.log('\n=== ПРОВЕРКА КЕША NPM ===');
try {
  const { execSync } = require('child_process');
  const npmCache = execSync('npm cache verify').toString();
  console.log('Результат проверки кеша npm:', npmCache);
} catch (error) {
  console.log('Ошибка при проверке кеша npm:', error.message);
}

console.log('\n=== ДИАГНОСТИКА ЗАВЕРШЕНА ===');
