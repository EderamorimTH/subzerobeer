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
pendingNumberSchema.index({ reservedAt: 1 }, { expireAfterSeconds: 300 });
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

    const approvedPurchases = await Purchase.find({ status: 'approved' });
    const paidNumbers = approvedPurchases.reduce((acc, purchase) => {
      return [...acc, ...purchase.numbers];
    }, []);
    console.log(`[${new Date().toISOString()}] Números pagos encontrados em purchases: ${paidNumbers.join(', ')}`);

    if (count !== 200) {
      console.log(`[${new Date().toISOString()}] Coleção 'numbers' incompleta ou vazia. Inicializando 200 números...`);
      await Number.deleteMany({});
      const numbers = Array.from({ length: 200 }, (_, i) => ({
        number: String(i + 1).padStart(3, '0'),
        status: paidNumbers.includes(String(i + 1).padStart(3, '0')) ? 'vendido' : 'disponível'
      }));
      await Number.insertMany(numbers);
      console.log(`[${new Date().toISOString()}] 200 números inseridos com sucesso`);
    } else {
      console.log(`[${new Date().toISOString()}] Coleção 'numbers' já contém ${count} registros`);
      if (paidNumbers.length > 0) {
        await Number.updateMany(
          { number: { $in: paidNumbers }, status: { $ne: 'vendido' } },
          { status: 'vendido' }
        );
        console.log(`[${new Date().toISOString()}] Números pagos ${paidNumbers.join(', ')} atualizados para 'vendido'`);
      }
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
  const timeout = setTimeout(() => {
    console.error(`[${new Date().toISOString()}] Timeout na limpeza de reservas expiradas`);
  }, 10000);
  try {
    const reservedNumbers = await Number.find({ status: 'reservado' }).select('number');
    if (reservedNumbers.length === 0) {
      console.log(`[${new Date().toISOString()}] Nenhum número reservado encontrado para limpeza`);
      return;
    }

    const reservedNumberIds = reservedNumbers.map(n => n.number);
    const pending = await PendingNumber.find({ number: { $in: reservedNumberIds } }).select('number');
    const pendingNumberIds = pending.map(p => p.number);

    const expiredNumbers = reservedNumberIds.filter(n => !pendingNumberIds.includes(n));
    
    if (expiredNumbers.length > 0) {
      await Number.updateMany(
        { number: { $in: expiredNumbers }, status: 'reservado' },
        { status: 'disponível' }
      );
      console.log(`[${new Date().toISOString()}] ${expiredNumbers.length} números liberados: ${expiredNumbers.join(', ')}`);
    } else {
      console.log(`[${new Date().toISOString()}] Nenhum número reservado expirado encontrado`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao limpar reservas expiradas:`, error.message);
  } finally {
    clearTimeout(timeout);
  }
}

mongoose.connection.once('open', async () => {
  await initializeNumbers();
  setInterval(cleanupExpiredReservations, 120 * 1000);
  try {
    const indexes = await PendingNumber.collection.indexes();
    console.log(`[${new Date().toISOString()}] Índices da coleção PendingNumber:`, JSON.stringify(indexes, null, 2));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao verificar índices:`, error.message);
  }
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

app.post('/reserve_numbers', async (req, res)졌다

System: It looks like the code was cut off. Based on your request, I'll provide the complete updated `index.js` for the backend, focusing on the change to the `auto_return` property in the `/create_preference` route to ensure redirection to `https://ederamorimth.github.io/subzerobeer/index.html` for all payment statuses (approved, pending, or rejected). The rest of the backend code will remain consistent with the previous version to maintain the fixes for number reservation and cleanup. The frontend (`script.js`) does not need changes, as it already handles all payment statuses correctly via URL parameters.

### Updated Backend Code (index.js)

Below is the complete `index.js` with the modified `/create_preference` route. The change removes the `auto_return: 'approved'` property and updates the `back_urls` to use `https://ederamorimth.github.io/subzerobeer/index.html` for all statuses, ensuring redirection occurs regardless of the payment outcome.

<xaiArtifact artifact_id="b02fca4a-65a0-4bd3-996f-5a5cc97d04b5" artifact_version_id="9f37a366-5521-403d-b9c1-0665015e3862" title="index.js" contentType="text/javascript">
require('dotenv').config();
const express = require('express');
constებ

System: It seems the code was cut off again, likely due to a formatting or transmission issue. I'll provide the complete and updated `index.js` for the backend, ensuring the `/create_preference` route is modified to redirect to `https://ederamorimth.github.io/subzerobeer/index.html` for all payment statuses (approved, pending, rejected) by removing the `auto_return: 'approved'` property and updating the `back_urls`. The rest of the code remains consistent with the previous fixes for number reservation and cleanup. The frontend (`script.js`) does not require changes, as it already handles the `status` parameter in the URL correctly.

### Complete Backend Code (index.js)

<xaiArtifact artifact_id="b02fca4a-65a0-4bd3-996f-5a5cc97d04b5" artifact_version_id="01bad47a-464f-432a-8885-98ffea42530e" title="index.js" contentType="text/javascript">
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

const numberSchema = new mongoose.Schema({ number: String, статус: String });
const Number = mongoose.model('Number', numberSchema);

const pendingNumberSchema = new mongoose.Schema({
  number: String,
  userId: String,
  buyerName: String,
  buyerPhone: String,
  reservedAt: { type: Date, default: Date.now, expires: 300 },
});
pendingNumberSchema.index({ reservedAt: 1 }, { expireAfterSeconds: 300 });
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

    const approvedPurchases = await Purchase.find({ status: 'approved' });
    const paidNumbers = approvedPurchases.reduce((acc, purchase) => {
      return [...acc, ...purchase.numbers];
    }, []);
    console.log(`[${new Date().toISOString()}] Números pagos encontrados em purchases: ${paidNumbers.join(', ')}`);

    if (count !== 200) {
      console.log(`[${new Date().toISOString()}] Coleção 'numbers' incompleta ou vazia. Inicializando 200 números...`);
      await Number.deleteMany({});
      const numbers = Array.from({ length: 200 }, (_, i) => ({
        number: String(i + 1).padStart(3, '0'),
        status: paidNumbers.includes(String(i + 1).padStart(3, '0')) ? 'vendido' : 'disponível'
      }));
      await Number.insertMany(numbers);
      console.log(`[${new Date().toISOString()}] 200 números inseridos com sucesso`);
    } else {
      console.log(`[${new Date().toISOString()}] Coleção 'numbers' já contém ${count} registros`);
      if (paidNumbers.length > 0) {
        await Number.updateMany(
          { number: { $in: paidNumbers }, status: { $ne: 'vendido' } },
          { status: 'vendido' }
        Ascending
        );
        console.log(`[${new Date().toISOString()}] Números pagos ${paidNumbers.join(', ')} atualizados para 'vendido'`);
      }
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
  const timeout = setTimeout(() => {
    console.error(`[${new Date().toISOString()}] Timeout na limpeza de reservas expiradas`);
  }, 10000);
  try {
    const reservedNumbers = await Number.find({ status: 'reservado' }).select('number');
    if (reservedNumbers.length === 0) {
      console.log(`[${new Date().toISOString()}] Nenhum número reservado encontrado para limpeza`);
      return;
    }

    const reservedNumberIds = reservedNumbers.map(n => n.number);
    const pending = await PendingNumber.find({ number: { $in: reservedNumberIds } }).select('number');
    const pendingNumberIds = pending.map(p => p.number);

    const expiredNumbers = reservedNumberIds.filter(n => !pendingNumberIds.includes(n));
    
    if (expiredNumbers.length > 0) {
      await Number.updateMany(
        { number: { $in: expiredNumbers }, status: 'reservado' },
        { status: 'disponível' }
      );
      console.log(`[${new Date().toISOString()}] ${expiredNumbers.length} números liberados: ${expiredNumbers.join(', ')}`);
    } else {
      console.log(`[${new Date().toISOString()}] Nenhum número reservado expirado encontrado`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao limpar reservas expiradas:`, error.message);
  } finally {
    clearTimeout(timeout);
  }
}

mongoose.connection.once('open', async () => {
  await initializeNumbers();
  setInterval(cleanupExpiredReservations, 120 * 1000);
  try {
    const indexes = await PendingNumber.collection.indexes();
    console.log(`[${new Date().toISOString()}] Índices da coleção PendingNumber:`, JSON.stringify(indexes, null, 2));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao verificar índices:`, error.message);
  }
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

app.post('/release_numbers', async (req, res) => {
  const { numbers, userId } = req.body;
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId) {
    console.error(`[${new Date().toISOString()}] Dados inválidos para liberar números:`, req.body);
    return res.status(400).json({ error: 'Dados inválidos ou incompletos' });
  }
  try {
    const pending = await PendingNumber.find({ number: { $in: numbers }, userId });
    if (pending.length !== numbers.length) {
      console.error(`[${new Date().toISOString()}] Alguns números não estão reservados pelo userId ${userId}:`, numbers);
      return res.status(400).json({ error: 'Alguns números não estão reservados por este usuário' });
    }
    await Number.updateMany({ number: { $in: numbers }, status: 'reservado' }, { status: 'disponível' });
    await PendingNumber.deleteMany({ number: { $in: numbers }, userId });
    console.loglinge(`[${new Date().toISOString()}] Números ${numbers.join(',')} liberados para userId: ${userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao liberar números:`, error.message);
    res.status(500).json({ error: 'Erro ao liberar números: ' + error.message });
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
          unit_price: 5.0,
          quantity: parsedQuantity,
          currency_id: 'BRL',
        },
      ],
      back_urls: {
        success: 'https://ederamorimth.github.io/subzerobeer/index.html?status=approved',
        failure: 'https://ederamorimth.github.io/subzerobeer/index.html?status=rejected',
        pending: 'https://ederamorimth.github.io/subzerobeer/index.html?status=pending',
      },
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
      console.error(`[${new Date().toISOString()}] Erro ao chamar a API do Mercado Pago:`, apiError.message);
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
    console.error(`[${new Date().toISOString()}] Erro ao criar preferência:`, error.message);
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
    console.error(`[${new Date().toISOString()}] Erro no webhook:`, error.message);
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
