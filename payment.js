let selectedNumbers = [];
let userId = localStorage.getItem('userId') || (function() {
    const newUserId = Math.random().toString(36).substr(2, 9);
    localStorage.setItem('userId', newUserId);
    console.log(`[${new Date().toISOString()}] Novo userId gerado: ${newUserId}`);
    return newUserId;
})();
let isReserving = false; // Controle para evitar requisições duplicadas

async function checkBackendHealth() {
    try {
        const response = await fetch('https://subzerobeer.onrender.com/health', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
        console.log(`[${new Date().toISOString()}] Backend ativo`);
        return true;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao verificar backend:`, error.message);
        return false;
    }
}

async function loadNumbers() {
    const numbersGrid = document.getElementById('numbers-grid');
    const loadingMessage = document.getElementById('loading-message');
    const numberError = document.getElementById('number-error');
    const errorDetails = document.getElementById('error-details');
    numbersGrid.style.display = 'grid';
    numberError.style.display = 'none';
    loadingMessage.style.display = 'block';
    numbersGrid.innerHTML = '';

    const maxRetries = 3;
    let retries = 0;
    let numbers = [];

    while (retries < maxRetries) {
        try {
            console.log(`[${new Date().toISOString()}] Tentativa ${retries + 1} de carregar números`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const response = await fetch('https://subzerobeer.onrender.com/available_numbers', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`Erro HTTP: ${response.status} - ${response.statusText}`);
            numbers = await response.json();
            console.log(`[${new Date().toISOString()}] Números recebidos:`, JSON.stringify(numbers.slice(0, 5)));
            if (!Array.isArray(numbers)) {
                throw new Error('Resposta da API não é uma lista válida');
            }
            break;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Erro na tentativa ${retries + 1}:`, error.message);
            retries++;
            if (retries === maxRetries) {
                console.log(`[${new Date().toISOString()}] Fallback: preenchendo grade com números padrão`);
                numbers = Array.from({ length: 200 }, (_, i) => ({
                    number: String(i + 1).padStart(3, '0'),
                    status: 'reserved'
                }));
                errorDetails.innerHTML = '<p>Não foi possível conectar ao servidor. Tente novamente em alguns minutos ou entre em contato via <a href="https://instagram.com/Subzerobeercba" target="_blank">@SUBZEROBEERCBA</a>.</p>';
                numberError.style.display = 'block';
                setTimeout(loadNumbers, 10000);
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    loadingMessage.style.display = 'none';

    if (numbers.length === 0) {
        errorDetails.innerHTML = '<p>Nenhum número disponível no momento. Tente novamente mais tarde ou entre em contato via <a href="https://instagram.com/Subzerobeercba" target="_blank">@SUBZEROBEERCBA</a>.</p>';
        numberError.style.display = 'block';
        setTimeout(loadNumbers, 30000);
        return;
    }

    const allNumbers = Array.from({ length: 200 }, (_, i) => String(i + 1).padStart(3, '0'));
    allNumbers.forEach(number => {
        const numData = numbers.find(n => n.number === number) || { number, status: 'reserved' };
        const status = numData.status.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === 'disponivel' ? 'disponível' : numData.status;
        const cssStatus = status === 'disponível' ? 'available' : status === 'reservado' ? 'reserved' : 'sold';
        console.log(`[${new Date().toISOString()}] Processando número: ${number}`);
        const div = document.createElement('div');
        div.className = `number ${cssStatus}`;
        div.textContent = number;
        if (status === 'disponível') {
            div.classList.add('available');
            div.onclick = () => toggleNumberSelection(number, div);
        } else {
            div.classList.add(cssStatus);
            div.style.pointerEvents = 'none';
        }
        numbersGrid.appendChild(div);
    });

    if (numbers.every(n => n.status.normalize('NFD').replace(/[\u0300-\u036f]/g, '') !== 'disponivel')) {
        errorDetails.innerHTML = '<p>Todos os números estão reservados no momento. Novas vagas podem abrir em breve. Siga <a href="https://instagram.com/Subzerobeercba" target="_blank">@SUBZEROBEERCBA</a> para atualizações.</p>';
        numberError.style.display = 'block';
        setTimeout(loadNumbers, 30000);
    }
}

async function toggleNumberSelection(number, element) {
    if (isReserving) {
        console.log(`[${new Date().toISOString()}] Reserva em andamento, aguarde...`);
        return;
    }

    const index = selectedNumbers.indexOf(number);
    if (index === -1) {
        isReserving = true;
        try {
            console.log(`[${new Date().toISOString()}] Reservando número ${number} para userId: ${userId}`);
            const response = await fetch('https://subzerobeer.onrender.com/reserve_numbers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numbers: [number], userId })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Erro HTTP: ${response.status} - ${errorData.error || 'Erro desconhecido'}`);
            }
            const result = await response.json();
            if (result.success) {
                selectedNumbers.push(number);
                element.classList.remove('available');
                element.classList.add('selected');
                console.log(`[${new Date().toISOString()}] Número ${number} reservado`);
                setTimeout(() => checkReservation(number, element), 5 * 60 * 1000);
            } else {
                console.error(`[${new Date().toISOString()}] Erro ao reservar:`, result.message);
                alert('Erro ao reservar: ' + result.message);
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Erro ao reservar:`, error.message);
            alert('Erro ao reservar: ' + error.message);
        } finally {
            isReserving = false;
        }
    } else {
        selectedNumbers.splice(index, 1);
        element.classList.remove('selected');
        element.classList.add('available');
        console.log(`[${new Date().toISOString()}] Número ${number} desselecionado`);
    }
    updateForm();
}

async function checkReservation(number, element) {
    try {
        console.log(`[${new Date().toISOString()}] Verificando reserva do número ${number}`);
        const response = await fetch('https://subzerobeer.onrender.com/check_reservation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ numbers: [number], userId })
        });
        if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
        const result = await response.json();
        if (!result.valid) {
            element.classList.remove('selected');
            element.classList.add('available');
            selectedNumbers = selectedNumbers.filter(n => n !== number);
            updateForm();
            element.onclick = () => toggleNumberSelection(number, element);
            element.style.pointerEvents = 'auto';
            console.log(`[${new Date().toISOString()}] Reserva do número ${number} expirou`);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao verificar reserva ${number}:`, error.message);
    }
}

function updateForm() {
    const selectedNumbersSpan = document.getElementById('selected-numbers');
    const totalPriceSpan = document.getElementById('total-price');
    selectedNumbersSpan.textContent = selectedNumbers.length > 0 ? selectedNumbers.join(', ') : 'Nenhum';
    totalPriceSpan.textContent = (selectedNumbers.length * 5).toFixed(2); // Preço ajustado para R$ 5,00
    console.log(`[${new Date().toISOString()}] Formulário atualizado: Números: ${selectedNumbers}, Total: R$${totalPriceSpan.textContent}`);
}

async function checkReservation(numbers) {
    try {
        console.log(`[${new Date().toISOString()}] Verificando reserva para números: ${numbers}`);
        const response = await fetch('https://subzerobeer.onrender.com/check_reservation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ numbers, userId })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Erro HTTP ${response.status}: ${errorData.message || 'Erro desconhecido'}`);
        }
        const result = await response.json();
        console.log(`[${new Date().toISOString()}] Resultado da verificação de reserva:`, result);
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
                return;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const response = await fetch('https://subzerobeer.onrender.com/create_preference', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, quantity: parseInt(data.quantity, 10) }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);
            console.log(`[${new Date().toISOString()}] Status da resposta: ${response.status}`);
            const responseData = await response.json();
            console.log(`[${new Date().toISOString()}] Resposta da API:`, responseData);

            if (responseData.init_point) {
                console.log(`[${new Date().toISOString()}] Redirecionando para: ${responseData.init_point}`);
                window.location.assign(responseData.init_point);
            } else {
                console.warn(`[${new Date().toISOString()}] Resposta sem init_point:`, responseData);
                alert(responseData.error || 'Erro ao criar o pagamento. Tente novamente.');
            }
            return;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Erro na tentativa ${retries + 1}:`, error.message);
            retries++;
            if (retries === maxRetries) {
                alert('Erro ao conectar ao servidor após várias tentativas. Detalhes: ' + error.message);
                await fetch('https://subzerobeer.onrender.com/check_reservation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ numbers: data.numbers, userId: data.userId }),
                });
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
        const buyerName = document.getElementById('buyer-name').value;
        const buyerPhone = document.getElementById('buyer-phone').value;
        const quantity = parseInt(selectedNumbers.length, 10);

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
            userId
        };
        console.log(`[${new Date().toISOString()}] Enviando solicitação de pagamento:`, paymentData);

        await sendPaymentRequest(paymentData);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao processar formulário:`, error.message);
        alert('Erro ao processar pagamento: ' + error.message);
    } finally {
        loadingMessage.style.display = 'none';
    }
});

window.onload = async () => {
    const backendOk = await checkBackendHealth();
    if (!backendOk) {
        document.getElementById('number-error').style.display = 'block';
        document.getElementById('error-details').innerHTML = '<p>Não foi possível conectar ao servidor. Tente novamente em alguns minutos ou entre em contato via <a href="https://instagram.com/Subzerobeercba" target="_blank">@SUBZEROBEERCBA</a>.</p>';
    }
    await loadNumbers();
    const urlParams = new URLSearchParams(window.location.search);
    const status = urlParams.get('status');
    if (status === 'approved') {
        document.getElementById('success-message').style.display = 'block';
        selectedNumbers = [];
        updateForm();
        console.log(`[${new Date().toISOString()}] Pagamento aprovado`);
    } else if (status === 'rejected') {
        document.getElementById('error-message').style.display = 'block';
        selectedNumbers = [];
        updateForm();
        loadNumbers();
        console.log(`[${new Date().toISOString()}] Pagamento rejeitado`);
    } else if (status === 'pending') {
        document.getElementById('pending-message').style.display = 'block';
        console.log(`[${new Date().toISOString()}] Pagamento pendente`);
    }
};
```

**Mudanças no `payment.js`**:
- **Correção do erro de log**: Na função `loadNumbers`, mudei `console.log(... Processando número:`, { number, status, cssStatus })` para `console.log(... Processando número: ${number})`, logando apenas o número como string, o que elimina o erro "Processando número: Object".
- **Aumentado para 200 números**: Alterei `Array.from({ length: 150 }, ...)` para `Array.from({ length: 200 }, ...)` em dois lugares (na lógica de fallback e na geração de `allNumbers`).
- **Preço ajustado para R$ 5,00**: Na função `updateForm`, mudei `selectedNumbers.length * 10` para `selectedNumbers.length * 5` para refletir o preço de R$ 5,00 por número.

#### 2. `server.js` atualizado
O `server.js` também precisa ser ajustado para inicializar 200 números em vez de 150 na função `initializeNumbers`. Além disso, o preço no endpoint `/create_preference` deve ser atualizado para R$ 5,00. Aqui está o `server.js` completo:

<xaiArtifact artifact_id="a7ae21a3-fb91-4c5a-b28e-b7efd9778b9b" artifact_version_id="b496cddb-f3d4-4596-9ce6-f976bf023865" title="server.js" contentType="text/javascript">
```javascript
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
const port = process.env.PORT || 10000;

if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
  console.error(`[${new Date().toISOString()}] ACCESS_TOKEN do Mercado Pago não configurado.`);
  process.exit(1);
}

const mercadopago = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });

mongoose.set('strictQuery', true);
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log(`[${new Date().toISOString()}] Conectado ao MongoDB com sucesso`))
  .catch((err) => {
    console.error(`[${new Date().toISOString()}] Erro ao conectar ao MongoDB:`, err.message);
    process.exit(1);
  });

app.use(cors({ origin: ['https://subzerobeer.onrender.com', 'https://ederamorimth.github.io', 'http://localhost:3000'] }));
app.use(express.json());

const numberSchema = new mongoose.Schema({ number: String, status: String });
const Number = mongoose.model('Number', numberSchema);

const pendingNumberSchema = new mongoose.Schema({
  number: String,
  userId: String,
  buyerName: String,
  buyerPhone: String,
  reservedAt: { type: Date, default: Date.now, expires: 300 },
});
const PendingNumber = mongoose.model('PendingNumber', pendingNumberSchema);

const purchaseSchema = new mongoose.Schema({
  buyerName: String,
  buyerPhone: String,
  numbers: [String],
  status: String,
  date_approved: Date,
  paymentId: String,
});
const Purchase = mongoose.model('Purchase', purchaseSchema);

const winnerSchema = new mongoose.Schema({
  buyerName: String,
  buyerPhone: String,
  winningNumber: String,
  numbers: [String],
  drawDate: Date,
  prize: String,
  photoUrl: String,
});
const Winner = mongoose.model('Winner', winnerSchema);

async function initializeNumbers() {
  try {
    const count = await Number.countDocuments();
    console.log(`[${new Date().toISOString()}] Verificando coleção 'numbers': ${count} documentos encontrados`);

    // Obter números pagos da coleção purchases
    const approvedPurchases = await Purchase.find({ status: 'approved' });
    const paidNumbers = approvedPurchases.reduce((acc, purchase) => {
      return [...acc, ...purchase.numbers];
    }, []);
    console.log(`[${new Date().toISOString()}] Números pagos encontrados em purchases: ${paidNumbers.join(', ')}`);

    // Inicializar ou reinicializar a coleção numbers
    if (count < 200) {
      console.log(`[${new Date().toISOString()}] Coleção 'numbers' incompleta ou vazia. Inicializando números...`);
      await Number.deleteMany({});
      const numbers = Array.from({ length: 200 }, (_, i) => ({
        number: String(i + 1).padStart(3, '0'),
        status: paidNumbers.includes(String(i + 1).padStart(3, '0')) ? 'vendido' : 'disponível'
      }));
      await Number.insertMany(numbers);
      console.log(`[${new Date().toISOString()}] 200 números inseridos com sucesso, com números pagos marcados como 'vendido'`);
    } else {
      console.log(`[${new Date().toISOString()}] Coleção 'numbers' já contém ${count} registros`);
      // Atualizar números pagos para 'vendido'
      if (paidNumbers.length > 0) {
        await Number.updateMany(
          { number: { $in: paidNumbers }, status: { $ne: 'vendido' } },
          { status: 'vendido' }
        );
        console.log(`[${new Date().toISOString()}] Números pagos ${paidNumbers.join(', ')} atualizados para 'vendido'`);
      }
      // Corrigir status inválidos
      const invalidNumbers = await Number.find({ status: { $nin: ['disponível', 'reservado', 'vendido'] } });
      if (invalidNumbers.length > 0) {
        console.log(`[${new Date().toISOString()}] Encontrados ${invalidNumbers.length} números com status inválido. Corrigindo...`);
        await Number.updateMany(
          { status: { $nin: ['disponível', 'reservado', 'vendido'] } },
          { status: 'disponível' }
        );
      }
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao inicializar números:`, error.message);
  }
}

async function cleanupExpiredReservations() {
  try {
    const expired = await PendingNumber.find({ reservedAt: { $lte: new Date(Date.now() - 300000) } });
    if (expired.length > 0) {
      const expiredNumbers = expired.map(p => p.number);
      await Number.updateMany({ number: { $in: expiredNumbers }, status: 'reservado' }, { status: 'disponível' });
      await PendingNumber.deleteMany({ number: { $in: expiredNumbers } });
      console.log(`[${new Date().toISOString()}] Limpeza de ${expired.length} reservas expiradas concluída`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao limpar reservas expiradas:`, error.message);
  }
}

mongoose.connection.once('open', async () => {
  await initializeNumbers();
  setInterval(cleanupExpiredReservations, 60 * 1000);
});

app.get('/health', (_, res) => {
  console.log(`[${new Date().toISOString()}] Requisição à rota /health`);
  res.json({ status: 'OK' });
});

app.post('/verify-password', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.PAGE_PASSWORD;
  if (!correctPassword) {
    console.error(`[${new Date().toISOString()}] Senha não configurada no servidor`);
    return res.status(500).json({ error: 'Variável de ambiente não configurada' });
  }
  console.log(`[${new Date().toISOString()}] Verificando senha para acesso a sorteio.html`);
  if (password === correctPassword) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.get('/available_numbers', async (_, res) => {
  try {
    const numbers = await Number.find({}, 'number status');
    console.log(`[${new Date().toISOString()}] Retornando ${numbers.length} números:`, JSON.stringify(numbers.slice(0, 5)));
    res.json(numbers);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Erro ao buscar números:`, err.message);
    res.status(500).json({ error: 'Erro ao buscar números: ' + err.message });
  }
});

app.post('/reserve_numbers', async (req, res) => {
  const { numbers, userId, buyerName, buyerPhone } = req.body;
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId) {
    const missingFields = [];
    if (!numbers) missingFields.push('numbers');
    if (!Array.isArray(numbers) || numbers.length === 0) missingFields.push('numbers deve ser um array não vazio');
    if (!userId) missingFields.push('userId');
    console.error(`[${new Date().toISOString()}] Dados inválidos:`, { missingFields, received: req.body });
    return res.status(400).json({ error: `Dados inválidos ou incompletos: ${missingFields.join(', ')}` });
  }
  try {
    const available = await Number.find({ number: { $in: numbers }, status: 'disponível' });
    if (available.length !== numbers.length) {
      console.error(`[${new Date().toISOString()}] Alguns números indisponíveis:`, numbers);
      return res.json({ success: false, message: 'Alguns números indisponíveis' });
    }
    await Number.updateMany({ number: { $in: numbers } }, { status: 'reservado' });
    await PendingNumber.insertMany(numbers.map(n => ({
      number: n,
      userId,
      buyerName: buyerName || '',
      buyerPhone: buyerPhone || '',
      reservedAt: new Date()
    })));
    console.log(`[${new Date().toISOString()}] Números ${numbers.join(',')} reservados para userId: ${userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao reservar números:`, error.message);
    res.status(500).json({ error: 'Erro ao reservar números: ' + error.message });
  }
});

app.post('/check_reservation', async (req, res) => {
  const { numbers, userId } = req.body;
  try {
    const valid = await PendingNumber.find({ number: { $in: numbers }, userId });
    if (valid.length !== numbers.length) {
      await Number.updateMany({ number: { $in: numbers }, status: 'reservado' }, { status: 'disponível' });
      await PendingNumber.deleteMany({ number: { $in: numbers }, userId });
      console.log(`[${new Date().toISOString()}] Reserva inválida para números ${numbers.join(',')}`);
      return res.json({ valid: false });
    }
    console.log(`[${new Date().toISOString()}] Reserva válida para números ${numbers.join(',')}`);
    res.json({ valid: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao verificar reserva:`, error.message);
    res.status(500).json({ error: 'Erro ao verificar reserva: ' + error.message });
  }
});

app.post('/create_preference', async (req, res) => {
  const { numbers, userId, buyerName, buyerPhone, quantity } = req.body;
  try {
    const parsedQuantity = parseInt(quantity, 10);
    console.log(`[${new Date().toISOString()}] Dados recebidos em create_preference:`, {
      numbers,
      userId,
      buyerName,
      buyerPhone,
      quantity,
      parsedQuantity,
    });

    if (
      !numbers ||
      !Array.isArray(numbers) ||
      numbers.length === 0 ||
      !userId ||
      !buyerName ||
      !buyerPhone ||
      isNaN(parsedQuantity) ||
      parsedQuantity <= 0
    ) {
      console.error(`[${new Date().toISOString()}] Dados inválidos:`, {
        numbers,
        userId,
        buyerName,
        buyerPhone,
        quantity,
      });
      return res.status(400).json({ error: 'Dados inválidos ou incompletos' });
    }

    const validNumbers = await PendingNumber.find({ number: { $in: numbers }, userId });
    if (validNumbers.length !== numbers.length) {
      console.error(`[${new Date().toISOString()}] Números não reservados:`, numbers);
      return res.status(400).json({ error: 'Números não reservados' });
    }

    await PendingNumber.updateMany(
      { number: { $in: numbers }, userId },
      { $set: { buyerName, buyerPhone } }
    );

    const preference = {
      items: [
        {
          title: `Compra de ${parsedQuantity} número(s)`,
          unit_price: 5.0, // Preço ajustado para R$ 5,00
          quantity: parsedQuantity,
          currency_id: 'BRL',
        },
      ],
      back_urls: {
        success: 'https://subzerobeer.onrender.com/index.html?status=approved',
        failure: 'https://subzerobeer.onrender.com/index.html?status=rejected',
        pending: 'https://subzerobeer.onrender.com/index.html?status=pending',
      },
      auto_return: 'approved',
      external_reference: numbers.join(','),
      notification_url: 'https://subzerobeer.onrender.com/webhook',
    };

    console.log(`[${new Date().toISOString()}] JSON da preferência:`, JSON.stringify(preference, null, 2));

    if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
      console.error(`[${new Date().toISOString()}] ACCESS_TOKEN do Mercado Pago não configurado`);
      return res.status(500).json({ error: 'Configuração do Mercado Pago inválida' });
    }

    const preferenceClient = new Preference(mercadopago);
    let response;
    try {
      response = await preferenceClient.create({ body: preference });
    } catch (apiError) {
      console.error(`[${new Date().toISOString()}] Erro ao chamar a API do Mercado Pago:`, apiError.message, apiError.stack);
      return res.status(500).json({ error: `Erro ao chamar a API do Mercado Pago: ${apiError.message}` });
    }

    if (!response || !response.init_point) {
      console.error(`[${new Date().toISOString()}] Resposta inválida do Mercado Pago:`, response);
      return res.status(500).json({ error: 'Resposta inválida do Mercado Pago' });
    }

    console.log(
      `[${new Date().toISOString()}] Preferência criada para números ${numbers.join(',')}, init_point: ${
        response.init_point
      }`
    );
    res.json({ init_point: response.init_point });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao criar preferência:`, error.message, error.stack);
    res.status(500).json({ error: `Erro ao criar preferência: ${error.message}` });
  }
});

app.post('/webhook', async (req, res) => {
  const { type, data } = req.body;
  console.log(`[${new Date().toISOString()}] Webhook recebido:`, JSON.stringify(req.body, null, 2));
  if (type !== 'payment') {
    console.log(`[${new Date().toISOString()}] Ignorando webhook: tipo ${type} não é 'payment'`);
    return res.status(200).send('OK');
  }
  try {
    const paymentClient = new Payment(mercadopago);
    const payment = await paymentClient.get({ id: data.id });
    console.log(`[${new Date().toISOString()}] Resposta do paymentClient.get:`, JSON.stringify(payment, null, 2));
    const { status: paymentStatus, external_reference } = payment;
    if (!paymentStatus || !external_reference) {
      console.error(`[${new Date().toISOString()}] Dados de pagamento inválidos:`, payment);
      return res.status(400).json({ error: 'Dados de pagamento inválidos' });
    }
    const numbers = external_reference.split(',');
    if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
      console.error(`[${new Date().toISOString()}] Números inválidos no webhook:`, external_reference);
      return res.status(400).json({ error: 'Números inválidos' });
    }
    const pending = await PendingNumber.find({ number: { $in: numbers } });
    if (pending.length !== numbers.length) {
      console.error(`[${new Date().toISOString()}] Números pendentes não encontrados:`, numbers);
      await Number.updateMany({ number: { $in: numbers }, status: 'reservado' }, { status: 'disponível' });
      await PendingNumber.deleteMany({ number: { $in: numbers } });
      return res.status(400).json({ error: 'Números pendentes não encontrados' });
    }
    if (paymentStatus === 'approved') {
      await Number.updateMany({ number: { $in: numbers } }, { status: 'vendido' });
      await Purchase.create({
        buyerName: pending[0].buyerName,
        buyerPhone: pending[0].buyerPhone,
        numbers,
        status: 'approved',
        date_approved: new Date(),
        paymentId: data.id
      });
      await PendingNumber.deleteMany({ number: { $in: numbers } });
      console.log(`[${new Date().toISOString()}] Pagamento aprovado para números ${numbers.join(',')}, salvo como aprovado`);
    } else {
      await Purchase.create({
        buyerName: pending[0].buyerName,
        buyerPhone: pending[0].buyerPhone,
        numbers,
        status: paymentStatus,
        paymentId: data.id
      });
      console.log(`[${new Date().toISOString()}] Pagamento ${paymentStatus} para números ${numbers.join(',')}, salvo como ${paymentStatus}`);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro no webhook:`, error.message, error.stack);
    res.status(500).json({ error: 'Erro no webhook: ' + error.message });
  }
});

app.get('/purchases', async (_, res) => {
  try {
    const purchases = await Purchase.find({ status: { $in: ['approved', 'pending'] } });
    console.log(`[${new Date().toISOString()}] Retornando ${purchases.length} compras (aprovadas e pendentes)`);
    res.json(purchases);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao buscar compras:`, error.message);
    res.status(500).json({ error: 'Erro ao buscar compras: ' + error.message });
  }
});

app.get('/winners', async (_, res) => {
  try {
    const winners = await Winner.find();
    console.log(`[${new Date().toISOString()}] Retornando ${winners.length} ganhadores`);
    res.json(winners);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao buscar ganhadores:`, error.message);
    res.status(500).json({ error: 'Erro ao buscar ganhadores: ' + error.message });
  }
});

app.post('/save_winner', async (req, res) => {
  const { buyerName, buyerPhone, winningNumber, numbers, drawDate, prize, photoUrl } = req.body;
  if (!buyerName || !buyerPhone || !winningNumber || !numbers || !drawDate || !prize || !photoUrl) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }
  try {
    await Winner.create({ buyerName, buyerPhone, winningNumber, numbers, drawDate, prize, photoUrl });
    console.log(`[${new Date().toISOString()}] Ganhador salvo: ${buyerName}, número: ${winningNumber}`);
    res.json({ message: 'Ganhador salvo com sucesso' });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao salvar ganhador:`, error.message);
    res.status(500).json({ error: 'Erro ao salvar ganhador: ' + error.message });
  }
});

app.listen(port, () => {
  console.log(`[${new Date().toISOString()}] Servidor rodando na porta ${port}`);
});
```

**Mudanças no `server.js`**:
- **200 números**: Na função `initializeNumbers`, mudei `count < 150` para `count < 200` e `Array.from({ length: 150 }, ...)` para `Array.from({ length: 200 }, ...)`.
- **Preço de R$ 5,00**: No endpoint `/create_preference`, alterei `unit_price: 10.0` para `unit_price: 5.0`.

#### 3. `index.html` (sem alterações)
O `index.html` que forneci anteriormente já está correto e usa o endpoint `/verify-password` com a variável `PAGE_PASSWORD`. Não precisa de mudanças, mas para referência, ele já foi enviado no último comentário (com o overlay de senha e redirecionamento para `/subzerobeer/sorteio.html`).

#### 4. `package.json` (sem alterações)
O `package.json` que você forneceu já está correto e não precisa de mudanças, pois todas as dependências necessárias (`express`, `mongoose`, `cors`, `mercadopago`, `dotenv`) estão presentes.

### Passos para implementar
1. **Atualizar os arquivos**:
   - Substitua o `payment.js` na pasta `public/subzerobeer/` pelo código acima.
   - Substitua o `server.js` na raiz do seu projeto pelo código acima.
   - Confirme que o `index.html` na pasta `public/subzerobeer/` é o que forneci anteriormente (com o endpoint `/verify-password`).

2. **Verificar a variável `PAGE_PASSWORD`**:
   - Acesse o painel do Render (https://dashboard.render.com/).
   - Vá até o serviço `subzerobeer` > **Environment**.
   - Confirme que a variável `PAGE_PASSWORD` está definida (ex.: `minhasenha123`). Você mencionou que já corrigiu de `SITE_PASSWORD` para `PAGE_PASSWORD`, então isso deve estar OK.

3. **Fazer o deploy no Render**:
   - Envie os arquivos atualizados (`payment.js` e `server.js`) para o repositório do seu projeto (usando Git ou upload manual no Render).
   - No painel do Render, clique em **Manual Deploy** > **Deploy latest commit**.
   - Aguarde o deploy terminar (pode levar alguns minutos).

4. **Testar o site**:
   - Acesse `https://subzerobeer.onrender.com`.
   - **Verificar a grade de números**: Deve mostrar 200 números (001 a 200) em vez de 150.
   - **Verificar o preço**: Selecione alguns números e veja se o total no formulário é calculado como R$ 5,00 por número (ex.: 3 números = R$ 15,00).
   - **Testar a senha**: Clique no logo, digite a senha configurada no Render (ex.: `minhasenha123`), e confirme se redireciona para `/subzerobeer/sorteio.html`.
   - **Verificar o console**: Abra o console do navegador (F12 > Console) e veja se o erro `Processando número: Object` desapareceu. Agora, deve aparecer algo como `Processando número: 001`.

5. **Verificar os logs do Render**:
   - Se o erro 500 (`/verify-password: Failed to load resource: the server responded with a status of 500`) persistir, vá até o painel do Render > **Logs**.
   - Procure mensagens de erro próximas ao horário do teste (ex.: por volta de 01:20 PM -04, 06/07/2025).
   - Compartilhe qualquer mensagem de erro comigo para análise.

### Explicação simples para leigos
- **Erro no `payment.js`**: O código estava mostrando "Object" porque logava um objeto inteiro `{ number, status, cssStatus }` em vez de apenas o número (ex.: `001`). Mudei para logar só o número, corrigindo o erro.
- **200 números**: Atualizei o `payment.js` e o `server.js` para trabalhar com 200 números (001 a 200) em vez de 150.
- **Preço de R$ 5,00**: Corrigi o preço para R$ 5,00 por número no `payment.js` (no formulário) e no `server.js` (no pagamento do Mercado Pago).
- **Erro 500**: Como você corrigiu `SITE_PASSWORD` para `PAGE_PASSWORD`, o erro 500 deve estar resolvido, desde que a variável esteja configurada corretamente no Render. Se ainda aparecer, os logs do Render vão mostrar o motivo.

### Próximos passos
- **Suba os arquivos** atualizados (`payment.js` e `server.js`) para o repositório do seu projeto.
- **Confirme a variável `PAGE_PASSWORD`** no Render.
- **Faça o deploy** e teste o site.
- **Verifique o console do navegador** para confirmar que o erro `Processando número: Object` sumiu.
- **Se houver problemas** (como o erro 500 ou outro), compartilhe os logs do Render ou do console do navegador.
- **Se precisar de ajuda com o deploy** ou com o Git/Render, me avise que explico passo a passo.

Se tudo der certo, você terá 200 números disponíveis, cada um custando R$ 5,00, e o sistema de senha funcionando corretamente. Qualquer dúvida, é só chamar! 😊
