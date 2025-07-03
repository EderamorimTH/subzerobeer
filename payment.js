```javascript
// Adicionar ao início de payment.js
async function loadAvailableNumbers() {
    try {
        const response = await fetch('https://subzerobeer.onrender.com/available_numbers', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) {
            throw new Error(`Erro HTTP: ${response.status}`);
        }
        const availableNumbers = await response.json();
        console.log(`[${new Date().toISOString()}] Números disponíveis: ${JSON.stringify(availableNumbers)}`);
        // Atualize o DOM com os números disponíveis, ex.:
        // document.getElementById('numbers-list').innerHTML = availableNumbers.map(num => `<option>${num}</option>`).join('');
        return availableNumbers;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao carregar números disponíveis: ${error.message}`);
        alert('Erro ao conectar ao servidor. Tente novamente mais tarde.');
        return [];
    }
}

// Chamar ao carregar a página
document.addEventListener('DOMContentLoaded', async () => {
    await loadAvailableNumbers();
});

// Restante do payment.js (sem alterações)
function getSelectedNumbers() {
    return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
            if (typeof window.selectedNumbers !== 'undefined') {
                clearInterval(checkInterval);
                resolve(window.selectedNumbers || []);
            }
        }, 100);
        setTimeout(() => {
            clearInterval(checkInterval);
            console.error(`[${new Date().toISOString()}] selectedNumbers não definido após timeout`);
            resolve([]);
        }, 5000); // Timeout de 5 segundos
    });
}

function generateUserId() {
    const userId = Math.random().toString(36).substr(2, 9);
    localStorage.setItem('userId', userId);
    console.log(`[${new Date().toISOString()}] Novo userId gerado: ${userId}`);
    return userId;
}

async function checkReservation(numbers) {
    try {
        console.log(`[${new Date().toISOString()}] Verificando reserva dos números:`, numbers);
        const response = await fetch('https://subzerobeer.onrender.com/check_reservation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ numbers, userId: localStorage.getItem('userId') })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Erro HTTP: ${response.status} - ${errorData.error || 'Erro desconhecido'}`);
        }
        const result = await response.json();
        console.log(`[${new Date().toISOString()}] Resultado da verificação:`, result);
        return result.valid;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao verificar reserva:`, error.message);
        return false;
    }
}

async function sendPaymentRequest(data) {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            console.log(`[${new Date().toISOString()}] Tentativa ${retries + 1} de enviar pagamento:`, data);
            if (!await checkReservation(data.numbers)) {
                console.warn(`[${new Date().toISOString()}] Números inválidos ou já reservados`);
                alert('Um ou mais números selecionados já foram reservados ou vendidos por outra pessoa. Escolha outros números.');
                document.getElementById('loading-message').style.display = 'none';
                return;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const response = await fetch('https://subzerobeer.onrender.com/create_preference', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            console.log(`[${new Date().toISOString()}] Status da resposta: ${response.status}`);
            const responseData = await response.json();
            console.log(`[${new Date().toISOString()}] Resposta da API:`, responseData);

            if (responseData.init_point) {
                console.log(`[${new Date().toISOString()}] Redirecionando para:`, responseData.init_point);
                window.location.assign(responseData.init_point);
            } else {
                console.warn(`[${new Date().toISOString()}] Resposta sem init_point:`, responseData);
                alert(responseData.error || 'Erro ao criar o pagamento. Tente novamente.');
            }
            document.getElementById('loading-message').style.display = 'none';
            return;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Erro na tentativa ${retries + 1}:`, error.message, 'Stack:', error.stack, 'Code:', error.code);
            retries++;
            if (retries === maxRetries) {
                alert('Erro ao conectar ao servidor após várias tentativas. Detalhes: ' + error.message + '\nCódigo: ' + (error.code || 'desconhecido') + '\nStatus: ' + (error.status || 'desconhecido'));
                document.getElementById('loading-message').style.display = 'none';
            } else {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }
}

document.getElementById('payment-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const loadingMessage = document.getElementById('loading-message');
    loadingMessage.style.display = 'block';
    console.log(`[${new Date().toISOString()}] Formulário enviado`);

    try {
        const selectedNumbers = await getSelectedNumbers();
        const buyerName = document.getElementById('buyer-name').value;
        const buyerPhone = document.getElementById('buyer-phone').value;
        const quantity = selectedNumbers.length;

        console.log(`[${new Date().toISOString()}] Dados do formulário:`, { buyerName, buyerPhone, selectedNumbers, quantity });

        if (selectedNumbers.length === 0) {
            console.warn(`[${new Date().toISOString()}] Nenhum número selecionado`);
            alert('Por favor, selecione pelo menos um número.');
            loadingMessage.style.display = 'none';
            return;
        }
        if (!buyerName || !buyerPhone) {
            console.warn(`[${new Date().toISOString()}] Campos obrigatórios não preenchidos`);
            alert('Por favor, preencha todos os campos.');
            loadingMessage.style.display = 'none';
            return;
        }

        localStorage.setItem('buyerName', buyerName);
        localStorage.setItem('buyerPhone', buyerPhone);

        const paymentData = {
            quantity,
            buyerName,
            buyerPhone,
            numbers: selectedNumbers,
            userId: localStorage.getItem('userId') || generateUserId()
        };
        console.log(`[${new Date().toISOString()}] Enviando solicitação de pagamento:`, paymentData);

        await sendPaymentRequest(paymentData);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao processar formulário:`, error.message);
        alert('Erro ao processar pagamento: ' + error.message);
        loadingMessage.style.display = 'none';
    }
});
```

#### Mudanças em `payment.js`
1. **Função `loadAvailableNumbers`**:
   - Adicionada para fazer uma requisição `GET` ao endpoint `/available_numbers`.
   - Exibe os números disponíveis no console e pode ser adaptada para atualizar o DOM (exemplo comentado).
2. **Evento `DOMContentLoaded`**:
   - Chama `loadAvailableNumbers` quando a página carrega.
3. **Sem alterações no restante**: O código original foi mantido, pois já está correto para as outras funcionalidades.

#### 3. Configuração no Render
1. **Adicionar MongoDB URI**:
   - Configure a variável de ambiente `MONGODB_URI` no painel do Render (Settings > Environment Variables). Exemplo: `mongodb+srv://user:password@cluster.mongodb.net/subzerobeer?retryWrites=true&w=majority`.
   - Certifique-se de que o MongoDB está acessível (e.g., MongoDB Atlas ou outro serviço).
2. **Verificar `MERCADO_PAGO_ACCESS_TOKEN`**:
   - Confirme que a variável de ambiente `MERCADO_PAGO_ACCESS_TOKEN` está configurada corretamente no Render.
3. **Atualizar Dependências**:
   - O `package.json` já inclui `mongoose`, `cors`, e `dotenv`. Execute `yarn install` (ou `npm install`) após atualizar os arquivos.
4. **Redeploy**:
   - Faça push das alterações para o repositório GitHub (`https://github.com/EderamorimTH/subzerobeer`).
   - O Render detectará o commit e redeployará automaticamente.

#### 4. Debugging do Erro de Conexão
O erro "Erro ao conectar ao servidor" pode ser causado por:
- **CORS**: O `cors` foi adicionado ao `server.js` para permitir requisições do front-end.
- **Timeout**: O `payment.js` já tem um timeout de 10 segundos nas requisições. Verifique se o servidor responde dentro desse tempo.
- **URL do Servidor**: Confirme que `https://subzerobeer.onrender.com` está correto no `payment.js`. Se o front-end está hospedado em outro domínio, certifique-se de que não há bloqueios de rede.
- **Logs do Servidor**: Acesse os logs no Render para verificar se há erros no endpoint `/available_numbers` ou outros.

#### 5. Testes
1. **Carregar Números**:
   - Acesse `https://subzerobeer.onrender.com/available_numbers` diretamente no navegador ou via `curl` para verificar se retorna um array de números.
   - No console do navegador, veja os logs de `loadAvailableNumbers` para confirmar que os números são recebidos.
2. **Formulário**:
   - Teste o formulário de pagamento para garantir que as reservas e o redirecionamento ao Mercado Pago funcionam.
3. **MongoDB**:
   - Verifique no MongoDB (e.g., MongoDB Atlas) se os documentos estão sendo criados na coleção `numbers`.

Se o problema persistir (e.g., números ainda não aparecem ou erro de conexão), compartilhe:
- Os logs do console do navegador.
- Os logs do servidor no Render.
- O trecho do HTML/JS que renderiza os números na interface.

Isso permitirá identificar se o problema está no front-end, servidor, ou banco de dados.
