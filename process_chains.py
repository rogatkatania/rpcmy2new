#!/usr/bin/env python3
import json
import re

# Загрузка полного списка сетей
with open('chains_full.json', 'r') as f:
    chains = json.load(f)

# Создаем словарь для mainnet сетей
mainnet_chains = {}

# Регулярное выражение для поиска слов, указывающих на testnet
testnet_pattern = re.compile(r'test|goerli|sepolia|holesky|rinkeby|ropsten|kovan|staging|dev', re.IGNORECASE)

# Обработка каждой сети
for chain in chains:
    chain_id = chain.get('chainId')
    name = chain.get('name', '')
    title = chain.get('title', '')
    status = chain.get('status', 'active')
    
    # Пропускаем тестовые и устаревшие сети
    if status == 'deprecated':
        continue
    
    # Проверяем, не является ли сеть тестовой по названию
    if testnet_pattern.search(name) or testnet_pattern.search(title):
        # Исключение для сетей, которые могут содержать "test" в названии, но являются mainnet
        if not any(keyword in name.lower() for keyword in ['protest', 'contest', 'attest']):
            continue
    
    # Добавляем сеть в словарь mainnet сетей
    mainnet_chains[chain_id] = {
        "id": chain_id,
        "name": name,
        "short_name": chain.get('shortName', ''),
        "chain": chain.get('chain', ''),
        "currency": chain.get('nativeCurrency', {}).get('symbol', '')
    }

# Сортировка по chain_id
sorted_chains = sorted(mainnet_chains.values(), key=lambda x: x['id'])

# Сохранение в JSON файл
with open('mainnet_chains.json', 'w') as f:
    json.dump(sorted_chains, f, indent=2)

print(f"Обработано {len(chains)} сетей, найдено {len(mainnet_chains)} mainnet сетей.")
