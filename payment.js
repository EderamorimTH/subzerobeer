let selectedNumbers = [];
let userId = localStorage.getItem('userId') || (function() {
    const newUserId = Math.random().toString(36).substr(2, 9);
    localStorage.setItem('userId', newUserId);
    console.log(`[${new Date().toISOString()}] Novo userId gerado: ${newUserId}`);
    return newUserId;
})();
let isReserving = false;

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
    
    if (!numbersGrid || !loadingMessage || !numberError || !errorDetails) {
        console.error(`[${new Date().toISOString()}] Elementos do DOM não encontrados`);
        return;
    }

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
                    status: 'disponível'
                }));
                errorDetails.innerHTML = '<p>Não foi possível conectar ao servidor. Exibindo números padrão. Tente novamente em alguns minutos ou entre em contato via <a href="https://instagram.com/Subzerobeercba" target="_blank">@SUBZEROBEERCBA</a>.</p>';
                numberError.style.display = 'block';
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    loadingMessage.style.display = 'none';

    console.log(`[${new Date().toISOString()}] Total de números a processar: ${numbers.length}`);
    if (numbers.length === 0) {
        errorDetails.innerHTML = '<p>Nenhum número disponível no momento. Tente novamente mais tarde ou entre em contato via <a href="https://instagram.com/Subzerobeercba" target="_blank">@SUBZEROBEERCBA</a>.</p>';
        numberError.style.display = 'block';
        setTimeout(loadNumbers, 30000);
        return;
    }

    const allNumbers = Array.from({ length: 200 }, (_, i) => String(i + 1).padStart(3, '0'));
    allNumbers.forEach(number => {
        const numData = numbers.find(n => n.number === number) || { number, status: 'disponível' };
        const status = numData.status.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === 'disponivel' ? 'disponível' : numData.status;
        const cssStatus = status === 'disponível' ? 'available' : status === 'reservado' ? 'reserved' : 'sold';
        console.log(`[${new Date().toISOString()}] Processando número: ${number}, status: ${status}`);
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
            console.log(`[${new Date().toISOString()}] Verificando disponibilidade do número ${number} antes de reservar`);
            const checkResponse = await fetch('https://subzerobeer.onrender.com/check_reservation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numbers: [number], userId: null })
            });
            if (!checkResponse.ok) {
                throw new Error(`Erro HTTP ${checkResponse.status}: Falha ao verificar disponibilidade do número ${number}`);
            }
            const checkResult = await checkResponse.json();
            console.log(`[${new Date().toISOString()}] Resultado da verificação de disponibilidade para ${number}:`, checkResult);

            if (!checkResult.valid || checkResult.statuses?.[number] !== 'disponível') {
                throw new Error(`Número ${number} não está disponível. Status: ${checkResult.statuses?.[number] || 'desconhecido'}`);
            }

            console.log(`[${new Date().toISOString()}] Reservando número ${number} para userId: ${userId}`);
            const response = await fetch('https://subzerobeer.onrender.com/reserve_numbers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numbers: [number], userId })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Erro HTTP ${response.status}: ${errorData.error || 'Erro desconhecido'}`);
            }
            const result = await response.json();
            if (result.success) {
                selectedNumbers.push(number);
                element.classList.remove('available');
                element.classList.add('selected');
                console.log(`[${new Date().toISOString()}] Número ${number} reservado com sucesso`);
                setTimeout(() => checkReservation(number, element), 5 * 60 * 1000);
            } else {
                console.error(`[${new Date().toISOString()}] Erro ao reservar:`, result.message);
                throw new Error(result.message || 'Erro desconhecido ao reservar');
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Erro ao reservar o número ${number}:`, error.message);
            alert(`Não foi possível reservar o número ${number}: ${error.message}. A grade será atualizada.`);
            await loadNumbers();
        } finally {
            isReserving = false;
        }
    } else {
        selectedNumbers.splice(index, 1);
        element.classList.remove('selected');
        element.classList.add('available');
        console.log(`[${new Date().toISOString()}] Número ${number} desselecionado`);
        await loadNumbers();
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
        if (!response.ok) {
            throw new Error(`Erro HTTP ${response.status}: Falha ao verificar reserva do número ${number}`);
        }
        const result = await response.json();
        console.log(`[${new Date().toISOString()}] Resultado da verificação para ${number}:`, result);
        if (!result.valid || result.statuses?.[number] !== 'reservado') {
            console.log(`[${new Date().toISOString()}] Reserva do número ${number} expirou ou inválida`);
            element.classList.remove('selected');
            element.classList.add('available');
            selectedNumbers = selectedNumbers.filter(n => n !== number);
            element.onclick = () => toggleNumberSelection(number, element);
            element.style.pointerEvents = 'auto';
            updateForm();
            alert(`A reserva do número ${number} expirou ou não é mais válida. Por favor, selecione novamente se desejar.`);
            await loadNumbers();
        } else {
            console.log(`[${new Date().toISOString()}] Reserva do número ${number} ainda válida`);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao verificar reserva ${number}:`, error.message);
        alert(`Erro ao verificar a reserva do número ${number}. A grade será atualizada.`);
        await loadNumbers();
    }
}

function updateForm() {
    const selectedNumbersSpan = document.getElementById('selected-numbers');
    const totalPriceSpan = document.getElementById('total-price');
    if (!selectedNumbersSpan || !totalPriceSpan) {
        console.error(`[${new Date().toISOString()}] Elementos do formulário não encontrados`);
        return;
    }
    selectedNumbersSpan.textContent = selectedNumbers.length > 0 ? selectedNumbers.join(', ') : 'Nenhum';
    totalPriceSpan.textContent = (selectedNumbers.length * 5).toFixed(2);
    console.log(`[${new Date().toISOString()}] Formulário atualizado: Números: ${selectedNumbers}, Total: R$${totalPriceSpan.textContent}`);
}

async function checkReservations(numbers) {
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
        return result.valid && numbers.every(num => result.statuses?.[num] === 'reservado' && result.userIds?.[num] === userId);
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
            if (!await checkReservations(data.numbers)) {
                console.warn(`[${new Date().toISOString()}] Números inválidos ou já reservados`);
                alert('Um ou mais números selecionados já foram reservados ou vendidos por outra pessoa. Escolha outros números.');
                await loadNumbers();
                return;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const response = await fetch('https://subzerobeer.onrender.com/create_preference', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, quantity: parseInt(data.quantity, 10) }),
                signal: controller.signal
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
                    body: JSON.stringify({ numbers: data.numbers, userId: data.userId })
                });
                await loadNumbers();
            } else {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }
}

document.getElementById('payment-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const loadingMessage = document.getElementById('loading-message');
    if (!loadingMessage) {
        console.error(`[${new Date().toISOString()}] Elemento loading-message não encontrado`);
        return;
    }
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
        await loadNumbers();
    } finally {
        loadingMessage.style.display = 'none';
    }
});

window.onload = async () => {
    const backendOk = await checkBackendHealth();
    if (!backendOk) {
        const numberError = document.getElementById('number-error');
        const errorDetails = document.getElementById('error-details');
        if (numberError && errorDetails) {
            numberError.style.display = 'block';
            errorDetails.innerHTML = '<p>Não foi possível conectar ao servidor. Tente novamente em alguns minutos ou entre em contato via <a href="https://instagram.com/Subzerobeercba" target="_blank">@SUBZEROBEERCBA</a>.</p>';
        }
    }
    await loadNumbers();
    const urlParams = new URLSearchParams(window.location.search);
    const status = urlParams.get('status');
    if (status === 'approved') {
        const successMessage = document.getElementById('success-message');
        if (successMessage) successMessage.style.display = 'block';
        selectedNumbers = [];
        updateForm();
        console.log(`[${new Date().toISOString()}] Pagamento aprovado`);
        await loadNumbers();
    } else if (status === 'rejected') {
        const errorMessage = document.getElementById('error-message');
        if (errorMessage) errorMessage.style.display = 'block';
        selectedNumbers = [];
        updateForm();
        await loadNumbers();
        console.log(`[${new Date().toISOString()}] Pagamento rejeitado`);
    } else if (status === 'pending') {
        const pendingMessage = document.getElementById('pending-message');
        if (pendingMessage) pendingMessage.style.display = 'block';
        console.log(`[${new Date().toISOString()}] Pagamento pendente`);
    }
};
