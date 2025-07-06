const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const mercadopago = require('mercadopago');
const app = express();
const port = process.env.PORT || 10000;

// Configurar Mercado Pago
if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
  console.error('[' + new Date().toISOString() + '] ACCESS_TOKEN do Mercado Pago não configurado');
  process.exit(1);
}
mercadopago.configure({
  access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN,
});

// Configurar strictQuery para evitar aviso de depreciação
mongoose.set('strictQuery', true);

// Configuração da URI do MongoDB
const mongoURI = process.env.MONGO_URI || 'mongodb+srv://Amorim:<db_password>@cluster0.8vhg4ws.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

// Conexão com o MongoDB
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('[' + new Date().toISOString() + '] Conectado ao MongoDB com sucesso'))
.catch((err) => {
  console.error('[' + new Date().toISOString() + '] Erro ao conectar ao MongoDB:', err);
  process.exit(1);
});

// Middleware
app.use(cors({
  origin: 'https://ederamorimth.github.io',
}));
app.use(express.json());

// Schema para números disponíveis
const numberSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  status: { type: String, enum: ['disponível', 'reservado', 'vendido'], default: 'disponível' },
});
const Number = mongoose.model('Number', numberSchema);

// Schema para números pendentes (com TTL de 5 minutos)
const pendingNumberSchema = new mongoose.Schema({
  number: { type: String, required: true },
  userId: String,
  buyerName: String,
  buyerPhone: String,
  reservedAt: { type: Date, default: Date.now, expires: 300 },
});
const PendingNumber = mongoose.model('PendingNumber', pendingNumberSchema);

// Schema para números vendidos
const soldNumberSchema = new mongoose.Schema({
  number: { type: String, required: true },
  buyerName: String,
  buyerPhone: String,
  status: { type: String, default: 'vendido' },
  timestamp: { type: Date, default: Date.now },
});
const SoldNumber = mongoose.model('SoldNumber', soldNumberSchema);

// Schema para compras aprovadas
const purchaseSchema = new mongoose.Schema({
  buyerName: String,
  buyerPhone: String,
  numbers: [String],
  status: { type: String, default: 'approved' },
  date_approved: { type: Date, default: Date.now },
  paymentId: String,
});
const Purchase = mongoose.model('Purchase', purchaseSchema);

// Schema para ganhadores
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

// Inicializar números no MongoDB
async function initializeNumbers() {
  const count = await Number.countDocuments();
  if (count === 0) {
    console.log('[' + new Date().toISOString() + '] Inicializando coleção de números');
    const numbers = Array.from({ length: 150 }, (_, i) => ({
      number: String(i + 1).padStart(3, '0'),
      status: 'disponível',
    }));
    await Number.insertMany(numbers);
    console.log('[' + new Date().toISOString() + '] 150 números inicializados como disponíveis');
  }
}

// Atualizar números expirados para disponível
async function cleanupExpiredReservations() {
  const expired = await PendingNumber.find({ reservedAt: { $lte: new Date(Date.now() - 300000) } });
  if (expired.length > 0) {
    const expiredNumbers = expired.map(p => p.number);
    await Number.updateMany(
      { number: { $in: expiredNumbers }, status: 'reservado' },
      { status: 'disponível' }
    );
    await PendingNumber.deleteMany({ number: { $in: expiredNumbers } });
    console.log('[' + new Date().toISOString() + '] Números expirados liberados:', expiredNumbers);
  }
}

// Chamar inicialização e configurar cleanup
mongoose.connection.once('open', async () => {
  await initializeNumbers();
  setInterval(cleanupExpiredReservations, 60 * 1000);
});

// Endpoint para verificar saúde do backend
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Endpoint para obter o hash da senha
app.get('/get-page-password', (req, res) => {
  const passwordHash = process.env.PAGE_PASSWORD;
  if (!passwordHash) {
    console.error('[' + new Date().toISOString() + '] Variável PAGE_PASSWORD não configurada');
    return res.status(500).json({ error: 'Variável de ambiente não configurada' });
  }
  res.json({ passwordHash });
});

// Endpoint para obter números disponíveis
app.get('/available_numbers', async (req, res) => {
  try {
    const numbers = await Number.find({}, 'number status');
    res.json(numbers);
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao buscar números:', error.message);
    res.status(500).json({ error: 'Erro ao buscar números' });
  }
});

// Endpoint para reservar números
app.post('/reserve_numbers', async (req, res) => {
  const { numbers, userId } = req.body;
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId) {
    return res.status(400).json({ error: 'Dados inválidos fornecidos' });
  }
  try {
    const available = await Number.find({ number: { $in: numbers }, status: 'disponível' });
    if (available.length !== numbers.length) {
      return res.json({ success: false, message: 'Alguns números não estão disponíveis' });
    }

    await Number.updateMany(
      { number: { $in: numbers }, status: 'disponível' },
      { status: 'reservado' }
    );
    await PendingNumber.insertMany(
      numbers.map(number => ({ number, userId, reservedAt: new Date() }))
    );
    console.log('[' + new Date().toISOString() + '] Números reservados:', numbers, 'para userId:', userId);
    res.json({ success: true });
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao reservar números:', error.message);
    res.status(500).json({ error: 'Erro ao reservar números' });
  }
});

// Endpoint para verificar reservas
app.post('/check_reservation', async (req, res) => {
  const { numbers, userId } = req.body;
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId) {
    return res.status(400).json({ error: 'Dados inválidos fornecidos' });
  }
  try {
    const validNumbers = await PendingNumber.find({ number: { $in: numbers }, userId });
    if (validNumbers.length !== numbers.length) {
      await Number.updateMany(
        { number: { $in: numbers }, status: 'reservado' },
        { status: 'disponível' }
      );
      await PendingNumber.deleteMany({ number: { $in: numbers }, userId });
      res.json({ valid: false });
    } else {
      res.json({ valid: true });
    }
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao verificar reserva:', error.message);
    res.status(500).json({ error: 'Erro ao verificar reserva' });
  }
});

// Endpoint para criar preferência de pagamento
app.post('/create_preference', async (req, res) => {
  const { numbers, userId, buyerName, buyerPhone, quantity } = req.body;
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId || !buyerName || !buyerPhone || !quantity) {
    return res.status(400).json({ error: 'Dados inválidos fornecidos' });
  }
  if (!/^\d{10,11}$/.test(buyerPhone)) {
    return res.status(400).json({ error: 'Telefone inválido' });
  }
  try {
    const validNumbers = await PendingNumber.find({ number: { $in: numbers }, userId });
    if (validNumbers.length !== numbers.length) {
      await Number.updateMany(
        { number: { $in: numbers }, status: 'reservado' },
        { status: 'disponível' }
      );
      await PendingNumber.deleteMany({ number: { $in: numbers }, userId });
      return res.status(400).json({ error: 'Alguns números não estão mais reservados' });
    }

    await PendingNumber.updateMany(
      { number: { $in: numbers }, userId },
      { $set: { buyerName, buyerPhone } }
    );

    const preference = {
      items: [
        {
          title: `Compra de ${quantity} numero(s) para sorteio`,
          unit_price: 10.0,
          quantity: quantity,
        },
      ],
      back_urls: {
        success: 'https://ederamorimth.github.io/subzerobeer/index.html?status=approved',
        failure: 'https://ederamorimth.github.io/subzerobeer/index.html?status=rejected',
        pending: 'https://ederamorimth.github.io/subzerobeer/index.html?status=pending',
      },
      auto_return: 'approved',
      external_reference: numbers.join(','),
      notification_url: 'https://subzerobeer.onrender.com/webhook',
    };

    const response = await mercadopago.preferences.create(preference);
    console.log('[' + new Date().toISOString() + '] Preferência criada:', response.body);
    res.json({ init_point: response.body.init_point });
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao criar preferência:', error.message);
    res.status(500).json({ error: 'Erro ao criar preferência' });
  }
});

// Endpoint para processar notificações de pagamento
app.post('/webhook', async (req, res) => {
  const { type, data } = req.body;
  if (type !== 'payment') {
    console.log('[' + new Date().toISOString() + '] Webhook ignorado: tipo', type);
    return res.status(200).send('OK');
  }

  const paymentId = data?.id;
  if (!paymentId) {
    console.error('[' + new Date().toISOString() + '] Webhook: paymentId não fornecido');
    return res.status(400).json({ error: 'paymentId não fornecido' });
  }

  try {
    const payment = await mercadopago.payment.findById(paymentId);
    const paymentStatus = payment.body.status;
    const numbers = payment.body.external_reference?.split(',');
    if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
      console.error('[' + new Date().toISOString() + '] Webhook: Números inválidos');
      return res.status(400).json({ error: 'Números inválidos' });
    }

    const pending = await PendingNumber.find({ number: { $in: numbers } });
    if (pending.length !== numbers.length) {
      await Number.updateMany(
        { number: { $in: numbers }, status: 'reservado' },
        { status: 'disponível' }
      );
      await PendingNumber.deleteMany({ number: { $in: numbers } });
      console.log('[' + new Date().toISOString() + '] Webhook: Números não encontrados, liberados:', numbers);
      return res.status(400).json({ error: 'Números não encontrados' });
    }

    if (paymentStatus === 'approved') {
      await Number.updateMany(
        { number: { $in: numbers }, status: 'reservado' },
        { status: 'vendido' }
      );
      await SoldNumber.insertMany(
        pending.map(p => ({
          number: p.number,
          buyerName: p.buyerName,
          buyerPhone: p.buyerPhone,
          status: 'vendido',
          timestamp: new Date(),
        }))
      );
      await Purchase.create({
        buyerName: pending[0].buyerName,
        buyerPhone: pending[0].buyerPhone,
        numbers,
        status: 'approved',
        date_approved: new Date(),
        paymentId,
      });
      await PendingNumber.deleteMany({ number: { $in: numbers } });
      console.log('[' + new Date().toISOString() + '] Pagamento aprovado, números marcados como vendido:', numbers);
    } else {
      await Number.updateMany(
        { number: { $in: numbers }, status: 'reservado' },
        { status: 'disponível' }
      );
      await PendingNumber.deleteMany({ number: { $in: numbers } });
      console.log('[' + new Date().toISOString() + '] Pagamento ' + paymentStatus + ', números liberados:', numbers);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro no webhook:', error.message);
    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
});

// Endpoint para obter compras aprovadas
app.get('/purchases', async (req, res) => {
  try {
    const purchases = await Purchase.find({ status: 'approved' });
    res.json(purchases);
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao buscar compras:', error.message);
    res.status(500).json({ error: 'Erro ao buscar compras' });
  }
});

// Endpoint para obter ganhadores
app.get('/winners', async (req, res) => {
  try {
    const winners = await Winner.find();
    res.json(winners);
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao buscar ganhadores:', error.message);
    res.status(500).json({ error: 'Erro ao buscar ganhadores' });
  }
});

// Endpoint para salvar ganhador
app.post('/save_winner', async (req, res) => {
  const { buyerName, buyerPhone, winningNumber, numbers, drawDate, prize, photoUrl } = req.body;
  if (!buyerName || !buyerPhone || !winningNumber || !numbers || !drawDate || !prize || !photoUrl) {
    return res.status(400).json({ error: 'Dados inválidos fornecidos' });
  }
  try {
    await Winner.create({ buyerName, buyerPhone, winningNumber, numbers, drawDate, prize, photoUrl });
    console.log('[' + new Date().toISOString() + '] Ganhador salvo:', { buyerName, winningNumber });
    res.status(200).json({ message: 'Ganhador salvo com sucesso' });
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao salvar ganhador:', error.message);
    res.status(500).json({ error: 'Erro ao salvar ganhador' });
  }
});

// Iniciar o servidor
app.listen(port, () => {
  console.log('[' + new Date().toISOString() + '] Servidor rodando na porta', port);
});
```
