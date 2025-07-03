```javascript
const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const app = express();

app.use(express.json());

// Configurar Mercado Pago
const mercadoPagoClient = new MercadoPagoConfig({
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

// Endpoint para verificar a saúde do servidor
app.get('/health', async (req, res) => {
    try {
        const compradoresCount = 100; // Substitua por lógica de banco de dados
        res.json({ status: 'OK', compradoresCount });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro no health check:`, error.message);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// Endpoint para números disponíveis
app.get('/available_numbers', async (req, res) => {
    try {
        const allNumbers = Array.from({ length: 100 }, (_, i) => String(i + 1).padStart(3, '0'));
        const soldNumbers = []; // Substitua por lógica de banco de dados
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
        const valid = true; // Substitua por lógica de banco de dados
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
        if (!quantity || !buyerName || !buyerPhone || !numbers || !userId) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        const preference = new Preference(mercadoPagoClient);
        const preferenceData = {
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

        const response = await preference.create({ body: preferenceData });
        console.log(`[${new Date().toISOString()}] Preferência criada:`, response.id);
        res.json({ init_point: response.init_point });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao criar preferência:`, error.message, error.stack);
        res.status(500).json({ error: 'Erro ao criar pagamento', details: error.message });
    }
});

// Endpoint para webhooks
app.post('/webhook', async (req, res) => {
    try {
        const { action, data, type } = req.body;
        console.log(`[${new Date().toISOString()}] Webhook recebido:`, req.body);

        if (type === 'payment' && action === 'payment.updated') {
            const payment = new Payment(mercadoPagoClient);
            const paymentDetails = await payment.get({ id: data.id });
            console.log(`[${new Date().toISOString()}] Detalhes do pagamento:`, paymentDetails);
            // Substitua por lógica para atualizar banco de dados
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
        const soldNumbers = 50; // Substitua por lógica de banco de dados
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
```

**Mudanças**:
1. Alterado `require('mercadopago').MercadoPago` para `require('mercadopago').MercadoPagoConfig, Preference, Payment`.
2. Configuração agora usa `MercadoPagoConfig` com `accessToken`.
3. Para criar preferências, usa `new Preference(mercadoPagoClient)` e `preference.create({ body: preferenceData })`.
4. Para pagamentos, usa `new Payment(mercadoPagoClient)` e `payment.get({ id: data.id })`.

**Ações**:
- Substitua o `server.js` pelo código acima.
- Verifique se `package.json` já está com `"mercadopago": "^2.5.17"`.
- Execute ` DIMENSION npm install` e redeploy no Render.com.
- Confirme que `MERCADO_PAGO_ACCESS_TOKEN` está configurado no ambiente do Render.

Isso corrige o erro e alinha o código com a versão 2.5.17 do Mercado Pago.
