// server.js
const express = require('express');
const mercadopago = require('mercadopago');
const app = express();

// Middleware para parsing de JSON
app.use(express.json());

// Configurar Mercado Pago
mercadopago.configure({
    access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

// Endpoint para verificar a saúde do servidor
app.get('/health', async (req, res) => {
    try {
        // Simular verificação do banco de dados (substitua por sua lógica real)
        const compradoresCount = 100; // Exemplo
        res.json({ status: 'OK', compradoresCount });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro no health check:`, error.message);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// Endpoint para verificar números disponíveis
app.get('/available_numbers', async (req, res) => {
    try {
        // Simular números disponíveis (substitua por sua lógica de banco de dados)
        const allNumbers = Array.from({ length: 100 }, (_, i) => String(i + 1).padStart(3, '0'));
        const soldNumbers = []; // Substitua por consulta ao banco de dados
        const availableNumbers = allNumbers.filter(num => !soldNumbers.includes(num));
        res.json(availableNumbers);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao carregar números disponíveis:`, error.message);
        res.status(500).json({ error: 'Erro ao carregar números' });
    }
});

// Endpoint para reservar números
app.post('/reserve_numbers', async (req, res) => {
    try {
        const { numbers, userId } = req.body;
        if (!numbers || !userId) {
            return res.status(400).json({ error: 'Números ou userId não fornecidos' });
        }
        // Simular reserva no banco de dados (substitua por sua lógica)
        console.log(`[${new Date().toISOString()}] Reservando números:`, numbers, 'para userId:', userId);
        res.json({ success: true });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao reservar números:`, error.message);
        res.status(500).json({ error: 'Erro ao reservar números' });
    }
});

// Endpoint para verificar reserva
app.post('/check_reservation', async (req, res) => {
    try {
        const { numbers, userId } = req.body;
        if (!numbers || !userId) {
            return res.status(400).json({ error: 'Números ou userId não fornecidos' });
        }
        // Simular verificação de reserva (substitua por sua lógica de banco de dados)
        const valid = true; // Verifique se os números estão disponíveis
        res.json({ valid });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao verificar reserva:`, error.message);
        res.status(500).json({ error: 'Erro ao verificar reserva' });
    }
});

// Endpoint para criar preferência de pagamento
app.post('/create_preference', async (req, res) => {
    try {
        const { quantity, buyerName, buyerPhone, numbers, userId } = req.body;

        // Validação dos dados
        if (!quantity || !buyerName || !buyerPhone || !numbers || !userId) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        // Criar preferência de pagamento
        const preference = {
            items: [{
                title: 'Sorteio Sub-zero Beer',
                quantity: parseInt(quantity),
                unit_price: 10.0,
                currency_id: 'BRL'
            }],
            payer: {
                name: buyerName,
                phone: { number: buyerPhone }
            },
            external_reference: userId,
            back_urls: {
                success: 'https://subzerobeer.onrender.com/sorteio.html?status=approved',
                failure: 'https://subzerobeer.onrender.com/sorteio.html?status=rejected',
                pending: 'https://subzerobeer.onrender.com/sorteio.html?status=pending'
            },
            auto_return: 'approved',
            metadata: { numbers }
        };

        const response = await mercadopago.preferences.create(preference);
        console.log(`[${new Date().toISOString()}] Preferência criada:`, response.body.id);
        res.json({ init_point: response.body.init_point });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao criar preferência:`, error.message, error.stack);
        res.status(500).json({ error: 'Erro ao criar pagamento', details: error.message });
    }
});

// Endpoint para webhooks do Mercado Pago
app.post('/webhook', async (req, res) => {
    try {
        const { action, data, type } = req.body;
        console.log(`[${new Date().toISOString()}] Webhook recebido:`, req.body);

        if (type === 'payment' && action === 'payment.updated') {
            const paymentId = data.id;
            const payment = await mercadopago.payment.get(paymentId);
            console.log(`[${new Date().toISOString()}] Detalhes do pagamento:`, payment.body);
            // Atualize o banco de dados com o status do pagamento
            // Exemplo: if (payment.body.status === 'approved') { salvar números no banco }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro no webhook:`, error.message);
        res.status(500).json({ error: 'Erro ao processar webhook' });
    }
});

// Endpoint para progresso
app.get('/progress', async (req, res) => {
    try {
        // Simular progresso (substitua por sua lógica de banco de dados)
        const soldNumbers = 50; // Exemplo
        const totalNumbers = 100;
        const progress = (soldNumbers / totalNumbers) * 100;
        res.json({ progress });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao carregar progresso:`, error.message);
        res.status(500).json({ error: 'Erro ao carregar progresso' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[${new Date().toISOString()}] Servidor rodando na porta ${PORT}`));
