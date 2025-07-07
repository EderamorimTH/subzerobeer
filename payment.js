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
            await loadNumbers(); // Recarrega a grade para refletir o estado atual
        } finally {
            isReserving = false;
        }
    } else {
        selectedNumbers.splice(index, 1);
        element.classList.remove('selected');
        element.classList.add('available');
        console.log(`[${new Date().toISOString()}] Número ${number} desselecionado`);
        await loadNumbers(); // Recarrega a grade para garantir consistência
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
            await loadNumbers(); // Recarrega a grade para refletir o estado mais recente
        } else {
            console.log(`[${new Date().toISOString()}] Reserva do número ${number} ainda válida`);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao verificar reserva ${number}:`, error.message);
        alert(`Erro ao verificar a reserva do número ${number}. A grade será atualizada.`);
        await loadNumbers(); // Recarrega a grade em caso de erro
    }
}
