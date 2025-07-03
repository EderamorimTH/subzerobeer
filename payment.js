async function checkReservation(numbers) {
    try {
        console.log(`[${new Date().toISOString()}] Verificando reserva para números: ${numbers}`);
        const response = await fetch('https://subzerobeer.onrender.com/check_reservation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ numbers, userId: localStorage.getItem('userId') })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Erro HTTP ${response.status}: ${errorData.error || 'Erro desconhecido'}`);
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
                alert('Um ou mais números selecionados já foram reservados ou vendidos por outra pessoa. Escolha outros números.');
                return;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const response = await fetch('https://subzerobeer.onrender.com/create_preference', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            console.log(`[${new Date().toISOString()}] Status da resposta: ${response.status}`);
            const responseData = await response.json();
            console.log(`[${new Date().toISOString()}] Resposta da API:`, responseData);

            if (responseData.init_point) {
                window.location.href = responseData.init_point;
            } else {
                alert(responseData.error || 'Erro ao criar o pagamento. Tente novamente.');
            }
            return;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Erro na tentativa ${retries + 1}:`, error.message, 'Stack:', error.stack, 'Code:', error.code);
            retries++;
            if (retries === maxRetries) {
                alert('Erro ao conectar ao servidor após várias tentativas. Detalhes: ' + error.message + '\nCódigo: ' + (error.code || 'desconhecido'));
            } else {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }
}

document.getElementById('payment-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const buyerName = document.getElementById('buyer-name').value;
    const buyerPhone = document.getElementById('buyer-phone').value;
    const quantity = window.selectedNumbers.length;

    console.log(`[${new Date().toISOString()}] Números selecionados antes de enviar:`, window.selectedNumbers);
    if (window.selectedNumbers.length === 0) {
        console.warn(`[${new Date().toISOString()}] Nenhum número selecionado`);
        alert('Por favor, selecione pelo menos um número.');
        return;
    }
    if (!buyerName || !buyerPhone) {
        console.warn(`[${new Date().toISOString()}] Campos de nome ou telefone não preenchidos`);
        alert('Por favor, preencha todos os campos.');
        return;
    }

    localStorage.setItem('buyerName', buyerName);
    localStorage.setItem('buyerPhone', buyerPhone);

    const paymentData = {
        quantity,
        buyerName,
        buyerPhone,
        numbers: window.selectedNumbers,
        userId: localStorage.getItem('userId') || generateUserId()
    };
    console.log(`[${new Date().toISOString()}] Enviando solicitação de pagamento:`, paymentData);

    await sendPaymentRequest(paymentData);
});
