# Mi Scale Dashboard

Painel caseiro (self-hosted) para a **Xiaomi Mi Body Composition Scale 2**. Um servidor perto
da balança escuta o que ela transmite por Bluetooth Low Energy. Cada pesagem aparece ao vivo
no navegador, vai para a pessoa certa e fica salva com a composição corporal. Não precisa de
conta da Xiaomi, do app Zepp Life nem de nuvem.

[English](README.md)

![Uma pesagem do começo ao fim](docs/screenshots/weigh-in.gif)

| Painel (claro) | Painel (escuro) |
| --- | --- |
| ![Painel, tema claro](docs/screenshots/dashboard-light.png) | ![Painel, tema escuro](docs/screenshots/dashboard-dark.png) |

| Pesagem: peso estável | Pesagem: composição corporal | Celular |
| --- | --- | --- |
| ![Tela da pesagem medindo](docs/screenshots/weighin-stable.png) | ![Tela da pesagem com o resultado](docs/screenshots/weighin-result.png) | ![Resultado no celular](docs/screenshots/mobile-result.png) |

Os dados das imagens são inventados (`scripts/seed_demo.py`). A foto do Alex foi gerada por
IA e não é de uma pessoa real ([docs/demo](docs/demo/README.md)). A interface também está em
português: ela segue o idioma do navegador, e dá para trocar em Configurações.

## Demonstração ao vivo

Experimente em **<https://brorlandi.github.io/miscale-dashboard/>**. É o mesmo painel rodando
inteiro no navegador, com dados inventados de duas pessoas fictícias. Não precisa de balança,
de Bluetooth nem de servidor. Toque em **▶ Iniciar demo** para ver uma pesagem do começo ao
fim. O que você mudar fica só na página e some quando ela é recarregada.

## Recursos

- **Tela de pesagem ao vivo.** Quando alguém sobe na balança, todo navegador aberto mostra o
  peso oscilando e depois travando. Alguns segundos depois aparece o resultado da
  bioimpedância: gordura, músculo, água, proteína, ossos, gordura visceral e metabolismo
  basal. A tela então fecha e o painel se atualiza com animação.
- **Vários perfis.** Cada pesagem vai para a pessoa com o último peso mais próximo, dentro de
  uma tolerância que você escolhe. Se não bater com ninguém, fica como "desconhecido" e dá
  para escolher a pessoa no histórico depois. Os perfis podem ter foto.
- **Composição corporal** calculada pela impedância, com as fórmulas abertas do openScale.
  Setas mostram a mudança desde a pesagem anterior, de 7 dias atrás ou de 30 dias atrás, em
  verde quando a mudança é boa e em vermelho quando é ruim.
- **Gráfico e histórico:** peso com média móvel de 7 dias e gordura, em 30 dias, 90 dias, 1
  ano ou tudo.
- **Avisos (opcionais)** de cada pesagem, por um webhook JSON genérico ou pelo seu próprio bot
  do Telegram.
- Inglês e português; kg ou lb; tema claro, escuro ou automático.
- **Instala no celular** como app (PWA).
- Um container, SQLite e nenhum serviço externo. O Chart.js vem junto, então funciona offline.

## O que você precisa

### 1. A balança

**Xiaomi Mi Body Composition Scale 2**, modelo **XMTZC05HM**. Ela aparece no Bluetooth como
`MIBFS`. A **Mi Smart Scale 2 (XMTZC04HM)** e outros modelos usam outro formato de pacote e
ainda não são suportados. Contribuições são bem-vindas.

### 2. Um computador com Bluetooth Low Energy perto da balança

Isso é obrigatório. O servidor **precisa ter um adaptador Bluetooth com suporte a BLE** e
ficar ao alcance do Bluetooth da balança, normalmente no mesmo cômodo ou no do lado. A
balança não pareia nem conecta: ela só transmite enquanto alguém está em cima, e o servidor
precisa ouvir essas transmissões diretamente.

Hardware que funciona, ou deve funcionar:

- Raspberry Pi 3, 4, 5 ou Zero 2 W (Bluetooth embutido)
- Mini PCs e NUCs com placa Intel de Wi-Fi + Bluetooth (AX200, AX201, AX210...). O projeto
  foi feito num Intel N100 com AX201.
- Qualquer Linux com um adaptador USB Bluetooth 4.0 ou mais novo

O ambiente suportado é **Linux com BlueZ** (o Bluetooth padrão do Ubuntu, do Debian e do
Raspberry Pi OS). Confira se o host enxerga dispositivos BLE:

```bash
bluetoothctl show            # deve listar um controlador com "Powered: yes"
sudo bluetoothctl scan le    # suba na balança: deve aparecer um dispositivo MIBFS
```

## Instalação com Docker

```bash
git clone https://github.com/BrOrlandi/miscale-dashboard.git
cd miscale-dashboard
cp .env.example .env          # configurações opcionais
docker compose up -d --build
```

Abra `http://<ip-do-servidor>:8800`, crie seu perfil com altura, nascimento e sexo e suba na
balança descalço até o fim da medição. O compose monta `/run/dbus` para falar com o BlueZ do
host e usa `apparmor=unconfined`, porque o perfil AppArmor padrão do Docker bloqueia o
D-Bus. Não precisa de `privileged` nem de `network_mode: host`.

Sem Docker, a instalação, as variáveis de ambiente, os avisos, a API e o desenvolvimento
estão no [README em inglês](README.md#install-without-docker). As variáveis mais usadas:

| Variável | O que faz |
| --- | --- |
| `TZ` | Fuso horário, ex. `America/Sao_Paulo` |
| `MISCALE_SCALE_MAC` | Aceitar só a sua balança (o endereço aparece em `/api/debug/devices`) |
| `MISCALE_LANG` | Idioma dos avisos: `en` ou `pt-BR` |
| `MISCALE_WEBHOOK_URL` | POST em JSON a cada pesagem |
| `MISCALE_TELEGRAM_TOKEN` / `MISCALE_TELEGRAM_CHAT_ID` | Avisos pelo seu bot do Telegram |

## Instalar no celular

O painel é um PWA: instala como app, abre em tela cheia com ícone próprio e abre mesmo com o
servidor fora do ar.

- **Android / Chrome / Edge:** aparece o botão "Instalar app" no topo (ou menu do navegador ›
  *Instalar app*).
- **iPhone / iPad (Safari):** uma dica aparece uma vez: toque em Compartilhar e depois em
  *Adicionar à Tela de Início*.

Os navegadores só instalam (e só rodam o service worker) com **HTTPS**. Sirva o painel por um
proxy reverso com certificado (Caddy, Traefik, nginx) ou pelo `tailscale serve`. Em
`http://<ip>:8800` ele funciona normalmente no navegador, e o iPhone até adiciona à tela de
início, mas o Android não oferece a instalação.

## Segurança

O painel **não tem login**. Use só na rede de casa, ou coloque atrás de um proxy reverso com
autenticação antes de expor. O proxy precisa repassar WebSocket (`/ws`).

## Aviso

A bioimpedância é uma estimativa que varia com hidratação, refeição e horário. Pese-se sempre
no mesmo horário e acompanhe a tendência. Isto não é um equipamento médico. O projeto não tem
relação com a Xiaomi.

## Licença

[MIT](LICENSE)
