async function checkReservation(numbers) {
    try {
        const response = await fetch('https://subzerobeer.onrender.com/check_reservation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ numbers, userId: localStorage.getItem('userId') })
        });
        if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
        const result = await response.json();
        return result.valid;
    } catch (error) {
        console.error('Erro ao verificar reserva:', error);
        return false;
    }
}

async function sendPaymentRequest(data) {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            console.log(`Tentativa ${retries + 1} de enviar pagamento em ${new Date().toISOString()}...`, data);
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
            console.log(`Status da resposta: ${response.status} em ${new Date().toISOString()}`);
            const responseData = await response.json();
            console.log('Resposta da API:', responseData);

            if (responseData.init_point) {
                window.location.href = responseData.init_point;
            } else {
                alert(responseData.error || 'Erro ao criar o pagamento. Tente novamente.');
            }
            return;
        } catch (error) {
            console.error(`Erro na tentativa ${retries + 1} em ${new Date().toISOString()}:`, error.message, 'Stack:', error.stack, 'Code:', error.code);
            retries++;
            if (retries === maxRetries) {
                alert('Erro ao conectar ao servidor após várias tentativas. Detalhes: ' + error.message + '\nCódigo: ' + (error.code || 'desconhecido') + '\nStatus: ' + (error.status || 'desconhecido'));
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
    const quantity = selectedNumbers.length;

    console.log('Números selecionados antes de enviar em:', new Date().toISOString(), selectedNumbers);
    if (selectedNumbers.length === 0) {
        console.warn('Nenhum número selecionado antes de enviar em:', new Date().toISOString());
        alert('Por favor, selecione pelo menos um número.');
        return;
    }
    if (!buyerName || !buyerPhone) {
        alert('Por favor, preencha todos os campos.');
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
    console.log('Enviando solicitação de pagamento em:', new Date().toISOString(), paymentData);

    await sendPaymentRequest(paymentData);
});
