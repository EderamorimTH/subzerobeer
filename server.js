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

// Schemas
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

const soldNumberSchema = new mongoose.Schema({
  number: String,
  buyerName: String,
  buyerPhone: String,
  status: String,
  timestamp: Date,
});
const SoldNumber = mongoose.model('SoldNumber', soldNumberSchema);

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
    if (count < 150) {
      console.log(`[${new Date().toISOString()}] Coleção 'numbers' incompleta ou vazia. Inicializando números...`);
      await Number.deleteMany({});
      const numbers = Array.from({ length: 150 }, (_, i) => ({
        number: String(i + 1).padStart(3, '0'),
        status: 'disponível'
      }));
      await Number.insertMany(numbers);
      console.log(`[${new Date().toISOString()}] 150 números inseridos com sucesso`);
    } else {
      console.log(`[${new Date().toISOString()}] Coleção 'numbers' já contém ${count} registros`);
      // Corrigir status inválidos
      const invalidNumbers = await Number.find({ status: { $nin: ['disponível', 'reservado', 'vendido'] } });
      if (invalidNumbers.length > 0) {
        console.log(`[${new Date().toISOString()}] Encontrados ${invalidNumbers.length} números com status inválido. Corrigindo...`);
        await Number.updateMany({ status: { $nin: ['disponível', 'reservado', 'vendido'] } }, { status: 'disponível' });
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

// --- ENDPOINTS --- //

app.get('/health', (_, res) => {
  console.log(`[${new Date().toISOString()}] Requisição à rota /health`);
  res.json({ status: 'OK' });
});

app.get('/get-page-password', (req, res) => {
  const passwordHash = process.env.PAGE_PASSWORD;
  if (!passwordHash) {
    console.error(`[${new Date().toISOString()}] Senha não configurada no servidor`);
    return res.status(500).json({ error: 'Variável de ambiente não configurada' });
  }
  console.log(`[${new Date().toISOString()}] Retornando hash da senha: ${passwordHash}`);
  res.json({ passwordHash });
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
  const { numbers, userId } = req.body;
  if (!numbers || !Array.isArray(numbers) || !userId) return res.status(400).json({ error: 'Dados inválidos' });
  try {
    const available = await Number.find({ number: { $in: numbers }, status: 'disponível' });
    if (available.length !== numbers.length) return res.json({ success: false, message: 'Alguns números indisponíveis' });
    await Number.updateMany({ number: { $in: numbers } }, { status: 'reservado' });
    await PendingNumber.insertMany(numbers.map(n => ({ number: n, userId })));
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
    const validNumbers = await PendingNumber.find({ number: { $in: numbers }, userId });
    if (validNumbers.length !== numbers.length) return res.status(400).json({ error: 'Números não reservados' });
    await PendingNumber.updateMany({ number: { $in: numbers }, userId }, { $set: { buyerName, buyerPhone } });
    const preference = {
      items: [{ title: `Compra de ${quantity} número(s)`, unit_price: 10.0, quantity }],
      back_urls: {
        success: 'https://subzerobeer.onrender.com/index.html?status=approved',
        failure: 'https://subzerobeer.onrender.com/index.html?status=rejected',
        pending: 'https://subzerobeer.onrender.com/index.html?status=pending',
      },
      auto_return: 'approved',
      external_reference: numbers.join(','),
      notification_url: 'https://subzerobeer.onrender.com/webhook',
    };
    const preferenceClient = new Preference(mercadopago);
    const response = await preferenceClient.create(preference);
    console.log(`[${new Date().toISOString()}] Preferência criada para números ${numbers.join(',')}`);
    res.json({ init_point: response.body.init_point });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao criar preferência:`, error.message);
    res.status(500).json({ error: 'Erro ao criar preferência: ' + error.message });
  }
});

app.post('/webhook', async (req, res) => {
  const { type, data } = req.body;
  if (type !== 'payment') return res.status(200).send('OK');
  try {
    const paymentClient = new Payment(mercadopago);
    const payment = await paymentClient.get({ id: data.id });
    const { status: paymentStatus, external_reference } = payment.body;
    const numbers = external_reference?.split(',');
    if (!numbers || !Array.isArray(numbers)) return res.status(400).json({ error: 'Números inválidos' });
    const pending = await PendingNumber.find({ number: { $in: numbers } });
    if (paymentStatus === 'approved') {
      await Number.updateMany({ number: { $in: numbers } }, { status: 'vendido' });
      await SoldNumber.insertMany(pending.map(p => ({ number: p.number, buyerName: p.buyerName, buyerPhone: p.buyerPhone, status: 'vendido', timestamp: new Date() })));
      await Purchase.create({ buyerName: pending[0].buyerName, buyerPhone: pending[0].buyerPhone, numbers, status: 'approved', date_approved: new Date(), paymentId: data.id });
      await PendingNumber.deleteMany({ number: { $in: numbers } });
      console.log(`[${new Date().toISOString()}] Pagamento aprovado para números ${numbers.join(',')}`);
    } else {
      await Number.updateMany({ number: { $in: numbers } }, { status: 'disponível' });
      await PendingNumber.deleteMany({ number: { $in: numbers } });
      console.log(`[${new Date().toISOString()}] Pagamento ${paymentStatus} para números ${numbers.join(',')}`);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro no webhook:`, error.message);
    res.status(500).json({ error: 'Erro no webhook: ' + error.message });
  }
});

app.get('/purchases', async (_, res) => {
  try {
    const purchases = await Purchase.find({ status: 'approved' });
    console.log(`[${new Date().toISOString()}] Retornando ${purchases.length} compras aprovadas`);
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
