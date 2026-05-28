const socket = io(); // Conexión al servidor
let username = "";

// 1. Registro inicial
function joinGame() {
    const input = document.getElementById('usernameInput');
    if (!input.value) return alert("Ingresa un nombre");
    username = input.value;
    socket.emit('join_game', username);
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    solicitarPregunta();
}

// 2. Pedir pregunta al servidor
function solicitarPregunta() {
    console.log("Solicitando pregunta al servidor...");
    socket.emit('get_pregunta');
}

// 3. RECIBIR PREGUNTA (El punto crítico)
socket.on('pregunta_data', (data) => {
    console.log("¡Pregunta recibida!", data);
    ocultarCargando(); // Asegúrate de tener esta función para quitar el mensaje de "Cargando"
    renderizarPregunta(data);
});

// 4. Manejo de resultados
socket.on('resultado_respuesta', (data) => {
    if (data.correcta) {
        alert("¡Correcto! Puntos: " + data.puntos);
    } else {
        alert("Incorrecto. Vidas restantes: " + data.vidas);
    }
    // Después de un tiempo, pedimos la siguiente
    setTimeout(solicitarPregunta, 1000);
});

// 5. Pantallas finales
socket.on('game_over', (data) => {
    alert("Juego terminado. Puntos totales: " + data.puntos);
    location.reload();
});

socket.on('game_completed', (data) => {
    alert("¡Completaste la trivia! Puntos: " + data.puntos);
    location.reload();
});

// --- FUNCIONES DE INTERFAZ ---

function renderizarPregunta(data) {
    const container = document.getElementById('preguntaContainer');
    container.innerHTML = `
        <h3>${data.pregunta}</h3>
        ${data.opciones.map(op => `
            <button onclick="enviarRespuesta('${data.id}', '${op}')">${op}</button>
        `).join('')}
    `;
}

function enviarRespuesta(preguntaId, respuesta) {
    const tiempo = 0; // Aquí deberías calcular el tiempo si lo usas
    socket.emit('enviar_respuesta', { 
        preguntaId, 
        respuesta, 
        intento: 1, 
        tiempoEmpleado: tiempo 
    });
}

function ocultarCargando() {
    document.getElementById('loadingMessage').style.display = 'none';
}
