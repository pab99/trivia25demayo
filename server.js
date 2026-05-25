
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Rutas de archivos
const PREGUNTAS_PATH = path.join(__dirname, 'preguntas.json');
const RANKING_PATH = path.join(__dirname, 'ranking_persistente.json');

// Cargar preguntas históricas
const preguntasTodo = JSON.parse(fs.readFileSync(PREGUNTAS_PATH, 'utf8'));

// Cargar ranking guardado previamente (si existe) para no perder nada al reiniciar
let jugadores = {};
if (fs.existsSync(RANKING_PATH)) {
    try {
        jugadores = JSON.parse(fs.readFileSync(RANKING_PATH, 'utf8'));
        console.log('📦 Base de datos local cargada con éxito. Jugadores recuperados:', Object.keys(jugadores).length);
    } catch (err) {
        console.log('⚠️ Error al leer el archivo de ranking persistente, iniciando vacío:', err.message);
        jugadores = {};
    }
} else {
    console.log('📝 No se encontró ranking previo. Iniciando base de datos limpia.');
}

// Función auxiliar para guardar el estado actual en el disco rígido virtual
function guardarRankingEnDisco() {
    try {
        fs.writeFileSync(RANKING_PATH, JSON.stringify(jugadores, null, 2), 'utf8');
    } catch (err) {
        console.log('❌ Error crítico al escribir el ranking en disco:', err.message);
    }
}

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.on('join_game', (username) => {
        const cleanUsername = username.toLowerCase().replace('@', '').trim();
        
        // Si el jugador YA EXISTÍA en el archivo, mantenemos sus puntos acumulados históricos
        if (jugadores[cleanUsername]) {
            console.log(`🔄 Reenganchando a @${cleanUsername}. Puntos previos: ${jugadores[cleanUsername].puntos}`);
            // Reseteamos las variables de la ronda actual pero preservamos su score máximo acumulado
            jugadores[cleanUsername].vidas = 3;
            jugadores[cleanUsername].respondidas = [];
            jugadores[cleanUsername].combo = 0;
            jugadores[cleanUsername].socketId = socket.id;
        } else {
            // Si es un jugador nuevo absoluto, lo creamos de cero
            jugadores[cleanUsername] = {
                username: cleanUsername,
                puntos: 0,
                vidas: 3,
                respondidas: [],
                combo: 0,
                socketId: socket.id
            };
        }
        
        socket.usernameClean = cleanUsername;
        guardarRankingEnDisco(); // Salvaguarda el estado por cualquier inconveniente
        enviarRanking();
    });

    socket.on('get_pregunta', () => {
        const cleanUsername = socket.usernameClean;
        const jugador = jugadores[cleanUsername];
        if (!jugador) return;

        if (jugador.vidas <= 0) {
            const puesto = obtenerPuesto(cleanUsername);
            socket.emit('game_over', { puntos: jugador.puntos, puesto: puesto });
            return;
        }

        if (jugador.respondidas.length >= 10) {
            const puesto = obtenerPuesto(cleanUsername);
            socket.emit('game_completed', { puntos: jugador.puntos, puesto: puesto });
            return;
        }

        const disponibles = preguntasTodo.filter(p => !jugador.respondidas.includes(p.id));
        if (disponibles.length === 0) {
            const puesto = obtenerPuesto(cleanUsername);
            socket.emit('game_completed', { puntos: jugador.puntos, puesto: puesto });
            return;
        }

        const pregunta = disponibles[Math.floor(Math.random() * disponibles.length)];
        const opciones = [pregunta.correcta, ...pregunta.incorrectas].sort(() => Math.random() - 0.5);

        socket.emit('pregunta_data', {
            id: pregunta.id,
            pregunta: pregunta.pregunta,
            options: opciones, // Mantenemos compatibilidad con tu frontend
            opciones: opciones,
            numeroPregunta: jugador.respondidas.length + 1
        });
    });

    socket.on('enviar_respuesta', ({ preguntaId, respuesta, intento, tiempoEmpleado }) => {
        const cleanUsername = socket.usernameClean;
        const jugador = jugadores[cleanUsername];
        if (!jugador) return;

        if (respuesta === "__TIEMPO_AGOTADO__") {
            jugador.respondidas.push(preguntaId);
            jugador.vidas -= 1;
            jugador.combo = 0;
            
            socket.emit('resultado_respuesta', { 
                correcta: false, 
                tiempoAgotado: true,
                intento: 2, 
                vidas: jugador.vidas 
            });
            guardarRankingEnDisco();
            enviarRanking();
            return;
        }

        const pregunta = preguntasTodo.find(p => p.id === preguntaId);
        const esCorrecta = pregunta.correcta === respuesta;

        if (esCorrecta) {
            jugador.respondidas.push(preguntaId);
            jugador.combo += 1;

            let puntosBase = intento === 1 ? 10 : 5;
            let bonusTiempo = Math.max(0, Math.round(15 * Math.log(20 / (tiempoEmpleado + 1))));
            let puntosPregunta = puntosBase + bonusTiempo;

            let multiplicador = 1;
            if (jugador.combo === 3) multiplicador = 2;
            if (jugador.combo === 6) multiplicador = 4;
            if (jugador.combo === 9) multiplicador = 6;
            if (jugador.combo === 12) multiplicador = 10;

            jugador.puntos += puntosPregunta * multiplicador;

            socket.emit('resultado_respuesta', { correcta: true, puntos: jugador.puntos, combo: jugador.combo });
        } else {
            if (intento === 1) {
                socket.emit('resultado_respuesta', { correcta: false, intento: 1 });
            } else {
                jugador.respondidas.push(preguntaId);
                jugador.vidas -= 1;
                jugador.combo = 0;
                socket.emit('resultado_respuesta', { correcta: false, intento: 2, vidas: jugador.vidas });
            }
        }
        guardarRankingEnDisco(); // Guardado automático tras cada respuesta procesada
        enviarRanking();
    });

    socket.on('reset_game', () => {
        const cleanUsername = socket.usernameClean;
        if (jugadores[cleanUsername]) {
            // Mantenemos los puntos totales del ranking acumulado, pero reseteamos la ronda de preguntas
            jugadores[cleanUsername].vidas = 3;
            jugadores[cleanUsername].respondidas = [];
            jugadores[cleanUsername].combo = 0;
            socket.emit('game_resetted');
            guardarRankingEnDisco();
            enviarRanking();
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
    });
});

function obtenerPuesto(username) {
    let listaOrdenada = Object.values(jugadores).sort((a, b) => b.puntos - a.puntos);
    let index = listaOrdenada.findIndex(j => j.username === username);
    return index !== -1 ? index + 1 : listaOrdenada.length;
}

function enviarRanking() {
    let lista = Object.values(jugadores).sort((a, b) => b.puntos - a.puntos);
    io.emit('update_ranking', lista);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor patrio e inmortal corriendo en puerto ${PORT}`));
