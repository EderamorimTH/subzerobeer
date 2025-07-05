const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: 'https://ederamorimth.github.io', credentials: true }));

mongoose.set('strictQuery', false);
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('[' + new Date().toISOString() + '] Conectado ao MongoDB'))
  .catch(err => console.error('[' + new Date().toISOString() + '] Erro ao conectar ao MongoDB: ' + err));

const compradorSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    status: { type: String, default: 'disponível' },
    userId: String,
    timestamp: Date,
});

const purchaseSchema = new mongoose.Schema({
    buyerName: { type: String, required: true },
    buyerPhone: { type: String, required: true },
    numbers: { type: [String], required: true },
    purchaseDate: { type: Date, default: Date.now },
    paymentId: String,
    status: { type: String, default: 'pending' },
    date_approved: Date,
    preference_id: String,
});

const winnerSchema = new mongoose.Schema({
    buyerName: { type: String, required: true },
    buyerPhone: { type: String, required: true },
    winningNumber: { type: String, required: true },
    numbers: { type: [String], required: true },
    drawDate: { type: Date, default: Date.now },
    photoUrl: { type: String, default: '' }
});

const Comprador = mongoose.model('Comprador', compradorSchema, 'compradores');
const Purchase = mongoose.model('Purchase', purchaseSchema, 'purchases');
const Winner = mongoose.model('Winner', winnerSchema, 'winners');

async function initializeNumbers() {
    try {
        const count = await Comprador.countDocuments();
        if (count === 0) {
            const numbers = Array.from({ length: 150 }, (_, i) => ({
                number: String(i + 1).padStart(3, '0'),
                status: 'disponível',
            }));
            await Comprador.insertMany(numbers);
            console.log('[' + new Date().toISOString() + '] Números de 001 a 150 inicializados na coleção compradores.');
        } else {
            console.log('[' + new Date().toISOString() + '] Coleção compradores já contém ' + count + ' documentos.');
        }
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao inicializar números: ' + error);
    }
}
initializeNumbers();

async function clearExpiredReservations() {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const expired = await Comprador.find({ status: 'reservado', timestamp: { $lt: fiveMinutesAgo } });
        const result = await Comprador.updateMany(
            { status: 'reservado', timestamp: { $lt: fiveMinutesAgo } },
            { $set: { status: 'disponível', userId: null, timestamp: null } }
        );
        if (result.modifiedCount > 0) {
            console.log('[' + new Date().toISOString() + '] Liberadas ' + result.modifiedCount + ' reservas expiradas. Números afetados: ' + expired.map(n => n.number).join(', '));
        }
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao liberar reservas expiradas: ' + error);
    }
}
setInterval(clearExpiredReservations, 5 * 60 * 1000);
clearExpiredReservations();

app.get('/available_numbers', async (req, res) => {
    try {
        await clearExpiredReservations();
        const numbers = await Comprador.find().select('number status');
        console.log('[' + new Date().toISOString() + '] Números retornados: ' + numbers.length + ', disponíveis: ' + numbers.filter(n => n.status === 'disponível').length);
        res.json(numbers.map(n => ({ number: n.number, status: n.status.toLowerCase() })));
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao buscar números disponíveis: ' + error);
        res.status(500).json({ error: 'Erro ao buscar números disponíveis', details: error.message });
    }
});

app.get('/progress', async (req, res) => {
    try {
        const total = await Comprador.countDocuments();
        const sold = await Comprador.countDocuments({ status: 'vendido' });
        const progress = total ? (sold / total) * 100 : 0;
        console.log('[' + new Date().toISOString() + '] Progresso: ' + progress + '% (' + sold + '/' + total + ')');
        res.json({ progress: progress });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao calcular progresso: ' + error);
        res.status(500).json({ error: 'Erro ao calcular progresso', details: error.message });
    }
});

app.get('/health', async (req, res) => {
    try {
        await mongoose.connection.db.admin().ping();
        const count = await Comprador.countDocuments();
        res.status(200).json({ status: 'OK', message: 'Servidor e MongoDB estão funcionando', compradoresCount: count });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro no health check: ' + error);
        res.status(500).json({ status: 'ERROR', message: 'Erro no servidor ou MongoDB', details: error.message });
    }
});

app.get('/get-page-password', (req, res) => {
    const requestId = Math.random().toString(36).substr(2, 9);
    console.log('[' + new Date().toISOString() + '] [' + requestId + '] Solicitação para obter hash da senha');
    const password = process.env.PAGE_PASSWORD;
    if (!password) {
        console.error('[' + new Date().toISOString() + '] [' + requestId + '] Senha não configurada no servidor');
        return res.status(500).json({ error: 'Senha não configurada no servidor' });
    }
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    res.json({ passwordHash: hash });
});

app.post('/save_winner', async (req, res) => {
    const { buyerName, buyerPhone, winningNumber, numbers, drawDate, photoUrl } = req.body;
    console.log('[' + new Date().toISOString() + '] Recebendo solicitação para salvar ganhador: buyerName=' + buyerName + ', winningNumber=' + winningNumber + ', numbers=' + JSON.stringify(numbers) + ', drawDate=' + drawDate + ', photoUrl=' + photoUrl);
    try {
        if (!buyerName || !buyerPhone || !winningNumber || !numbers || !drawDate || !photoUrl) {
            console.error('[' + new Date().toISOString() + '] Dados incompletos para salvar ganhador');
            return res.status(400).json({ error: 'Dados incompletos' });
        }
        const winner = new Winner({
            buyerName,
            buyerPhone,
            winningNumber,
            numbers,
            drawDate: new Date(drawDate),
            photoUrl
        });
        await winner.save();
        console.log('[' + new Date().toISOString() + '] Ganhador salvo com sucesso: ' + buyerName + ', número: ' + winningNumber + ', foto: ' + photoUrl);
        res.json({ success: true });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao salvar ganhador: ' + error);
        res.status(500).json({ error: 'Erro ao salvar ganhador', details: error.message });
    }
});

app.get('/winners', async (req, res) => {
    try {
        const winners = await Winner.find().sort({ drawDate: -1 });
        console.log('[' + new Date().toISOString() + '] Retornando ' + winners.length + ' ganhadores');
        res.json(winners);
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao buscar ganhadores: ' + error);
        res.status(500).json({ error: 'Erro ao buscar ganhadores', details: error.message });
    }
});

app.post('/upload_winner_photo', async (req, res) => {
    const { winnerId, winnerNumber } = req.body;
    console.log('[' + new Date().toISOString() + '] Recebendo solicitação para atualizar foto do ganhador: winnerId=' + winnerId + ', winnerNumber=' + winnerNumber);
    try {
        if (!winnerId || !winnerNumber || isNaN(winnerNumber) || winnerNumber < 1) {
            console.error('[' + new Date().toISOString() + '] Dados incompletos ou inválidos para atualizar foto');
            return res.status(400).json({ error: 'Dados incompletos ou inválidos (winnerId ou winnerNumber)' });
        }
        const photoUrl = '/subzerobeer/images/ganhador' + winnerNumber + '.jpg';
        const result = await Winner.updateOne(
            { _id: winnerId },
            { $set: { photoUrl } }
        );
        if (result.modifiedCount === 0) {
            console.error('[' + new Date().toISOString() + '] Ganhador não encontrado: ' + winnerId);
            return res.status(404).json({ error: 'Ganhador não encontrado' });
        }
        console.log('[' + new Date().toISOString() + '] Foto atualizada para ganhador: ' + winnerId + ', URL: ' + photoUrl);
        res.json({ success: true });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao atualizar foto: ' + error);
        res.status(500).json({ error: 'Erro ao atualizar foto', details: error.message });
    }
});

app.post('/reserve_numbers', async (req, res) => {
    const { numbers, userId } = req.body;
    console.log('[' + new Date().toISOString() + '] Recebendo solicitação para reservar números: ' + numbers + ', userId: ' + userId);
    try {
        if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId) {
            console.error('[' + new Date().toISOString() + '] Dados incompletos na solicitação de reserva');
            return res.status(400).json({ success: false, message: 'Dados incompletos' });
        }
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const availableNumbers = await Comprador.find({ number: { $in: numbers }, status: 'disponível' }).session(session);
            if (availableNumbers.length !== numbers.length) {
                await session.abortTransaction();
                session.endSession();
                console.error('[' + new Date().toISOString() + '] Alguns números não estão disponíveis: ' + numbers);
                return res.status(400).json({ success: false, message: 'Alguns números não estão disponíveis' });
            }
            const result = await Comprador.updateMany(
                { number: { $in: numbers }, status: 'disponível' },
                { $set: { status: 'reservado', userId, timestamp: new Date() } },
                { session }
            );
            await session.commitTransaction();
            session.endSession();
            console.log('[' + new Date().toISOString() + '] Números ' + numbers.join(', ') + ' reservados com sucesso para userId: ' + userId);
            res.json({ success: true });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao reservar números: ' + error);
        res.status(500).json({ success: false, message: 'Erro ao reservar números', details: error.message });
    }
});

app.post('/check_reservation', async (req, res) => {
    const { numbers, userId } = req.body;
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const validNumbers = await Comprador.find({
            number: { $in: numbers },
            status: 'reservado',
            userId,
            timestamp: { $gte: fiveMinutesAgo }
        });
        console.log('[' + new Date().toISOString() + '] Verificação de reserva para números ' + numbers.join(', ') + ', userId: ' + userId + ', válida: ' + (validNumbers.length === numbers.length));
        res.json({ valid: validNumbers.length === numbers.length });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao verificar reserva: ' + error);
        res.status(500).json({ valid: false, message: 'Erro ao verificar reserva', details: error.message });
    }
});

app.post('/create_preference', async (req, res) => {
    const { numbers, userId, buyerName, buyerPhone, quantity } = req.body;
    console.log('[' + new Date().toISOString() + '] Recebendo solicitação para criar preferência: numbers=' + JSON.stringify(numbers) + ', userId=' + userId + ', buyerName=' + buyerName + ', buyerPhone=' + buyerPhone + ', quantity=' + quantity);
    try {
        if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId || !buyerName || !buyerPhone || !quantity) {
            console.error('[' + new Date().toISOString() + '] Dados incompletos na solicitação de preferência');
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const validNumbers = await Comprador.find({
                number: { $in: numbers },
                status: 'reservado',
                userId,
                timestamp: { $gte: fiveMinutesAgo }
            }).session(session);
            if (validNumbers.length !== numbers.length) {
                await session.abortTransaction();
                session.endSession();
                console.error('[' + new Date().toISOString() + '] Números não estão reservados para userId: ' + userId);
                return res.status(400).json({ error: 'Números não estão mais reservados para você' });
            }

            const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
            const preference = new Preference(client);
            const response = await preference.create({
                body: {
                    items: numbers.map(number => ({
                        title: 'Número ' + number,
                        quantity: 1,
                        unit_price: 10,
                        currency_id: 'BRL'
                    })),
                    back_urls: {
                        success: 'https://ederamorimth.github.io/subzerobeer/index.html?status=approved',
                        failure: 'https://ederamorimth.github.io/subzerobeer/index.html?status=rejected',
                        pending: 'https://ederamorimth.github.io/subzerobeer/index.html?status=pending'
                    },
                    auto_return: 'approved',
                    external_reference: JSON.stringify({ numbers, userId, buyerName, buyerPhone }),
                    notification_url: 'https://subzerobeer.onrender.com/webhook'
                }
            });
            console.log('[' + new Date().toISOString() + '] Preferência criada: preference_id=' + response.id + ', init_point=' + response.init_point);

            const purchase = new Purchase({
                buyerName,
                buyerPhone,
                numbers,
                preference_id: response.id
            });
            await purchase.save({ session });

            await session.commitTransaction();
            session.endSession();
            res.json({ init_point: response.init_point });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao criar preferência: ' + error);
        res.status(500).json({ error: 'Erro ao criar preferência', details: error.message });
    }
});

app.post('/webhook', async (req, res) => {
    const payment = req.body;
    console.log('[' + new Date().toISOString() + '] Webhook recebido: ' + JSON.stringify(payment, null, 2));
    try {
        if (payment.type !== 'payment') {
            console.log('[' + new Date().toISOString() + '] Ignorando webhook: tipo inválido (' + payment.type + ')');
            return res.sendStatus(200);
        }

        const paymentId = payment.data.id;
        const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
        const paymentClient = new Payment(client);
        const paymentDetails = await paymentClient.get({ id: paymentId });
        console.log('[' + new Date().toISOString() + '] Resposta da API do Mercado Pago: ' + JSON.stringify(paymentDetails, null, 2));

        if (paymentDetails.status === 'approved') {
            let externalReference;
            try {
                externalReference = paymentDetails.external_reference ? JSON.parse(paymentDetails.external_reference) : {};
            } catch (e) {
                console.error('[' + new Date().toISOString() + '] Erro ao parsear external_reference: ' + e.message);
                return res.status(400).json({ error: 'Invalid external_reference', details: e.message });
            }

            const { numbers, userId, buyerName, buyerPhone } = externalReference;
            if (!numbers || !numbers.length || !userId) {
                console.error('[' + new Date().toISOString() + '] Dados incompletos em external_reference: ' + JSON.stringify(externalReference));
                return res.status(400).json({ error: 'Missing numbers or userId' });
            }

            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const validNumbers = await Comprador.find({
                    number: { $in: numbers },
                    status: 'reservado',
                    userId,
                }).session(session);
                if (validNumbers.length !== numbers.length) {
                    await session.abortTransaction();
                    session.endSession();
                    console.error('[' + new Date().toISOString() + '] Números não reservados para userId: ' + userId + ', números: ' + numbers.join(', '));
                    return res.status(400).json({ error: 'Números não reservados' });
                }

                const compradorResult = await Comprador.updateMany(
                    { number: { $in: numbers }, status: 'reservado', userId },
                    { $set: { status: 'vendido', userId: null, timestamp: null } },
                    { session }
                );
                console.log('[' + new Date().toISOString() + '] Compradores atualizados: ' + compradorResult.modifiedCount);

                const purchaseResult = await Purchase.updateMany(
                    { numbers: { $in: numbers }, status: 'pending' },
                    { $set: { status: 'approved', paymentId, date_approved: new Date() } },
                    { session }
                );
                console.log('[' + new Date().toISOString() + '] Compras atualizadas: ' + purchaseResult.modifiedCount);

                await session.commitTransaction();
                console.log('[' + new Date().toISOString() + '] Pagamento ' + paymentId + ' aprovado. Números ' + numbers.join(', ') + ' marcados como vendido.');
            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }
        } else {
            console.log('[' + new Date().toISOString() + '] Pagamento ' + paymentId + ' não aprovado. Status: ' + paymentDetails.status);
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro no webhook: ' + error.message + ', Stack: ' + error.stack);
        res.status(500).json({ error: 'Erro no webhook', details: error.message });
    }
});

app.get('/purchases', async (req, res) =>
