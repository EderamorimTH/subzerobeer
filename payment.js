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
            console.log(`[${new Date().toISOString()}] Números recebidos:`, numbers);

            if (!Array.isArray(numbers)) {
                throw new Error('Resposta da API não é uma lista válida');
            }
            break;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Erro na tentativa ${retries + 1}:`, error.message);
            retries++;
            if (retries === maxRetries) {
                console.log(`[${new Date().toISOString()}] Fallback: preenchendo grade com números padrão`);
                numbers = Array.from({ length: 150 }, (_, i) => ({
                    number: String(i + 1).padStart(3, '0'),
                    status: 'reservado'
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

    const allNumbers = Array.from({ length: 150 }, (_, i) => String(i + 1).padStart(3, '0'));
    allNumbers.forEach(number => {
        const numData = numbers.find(n => n.number === number) || { number, status: 'reservado' };
        // Normalizar o status para ignorar acentos
        const status = numData.status.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === 'disponivel' ? 'disponível' : numData.status;
        console.log(`[${new Date().toISOString()}] Processando número:`, { number, status });
        const div = document.createElement('div');
        div.className = `number ${status}`;
        div.textContent = number;
        if (status === 'disponível') {
            div.classList.add('available');
            div.onclick = () => toggleNumberSelection(number, div);
        } else {
            div.classList.add(status);
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
