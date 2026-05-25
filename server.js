const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PREGUNTAS_PATH = path.join(__dirname, 'preguntas.json');
const RANKING_PATH = path.join(__dirname, 'ranking_persistente.json');

const preguntasTodo = JSON.parse(fs.readFileSync(PREGUNTAS_PATH, 'utf8'));

let jugadores = {}; 

if (fs.existsSync(RANKING_PATH)) {
    try {
        jugadores = JSON.parse(fs.readFileSync(RANKING_PATH, 'utf8'));
        console.log('📦 Base de datos local recuperada. Usuarios:', Object.keys(jugadores).length);
    } catch (err) {
        console.log('⚠️ Error al leer ranking persistente:', err.message);
        jugadores = {};
    }
}

function guardarRankingEnDisco() {
    try {
        fs.writeFileSync(RANKING_PATH, JSON.stringify(jugadores, null, 2), 'utf8');
    } catch (err) {
        console.log('❌ Error al escribir en disco:', err.message);
    }
}

io.on('connection', (socket) => {
    console.log('Dispositivo conectado:', socket.id);

    let listaAlConectar = Object.values(jugadores).sort((a, b) => b.puntos - a.puntos);
    socket.emit('update_ranking', listaAlConectar);

    // BLINDAJE EXTENDIDO: Siempre que entra un usuario se le vacía el historial de la partida
    socket.on('join_game', (username) => {
        const cleanUsername = username.toLowerCase().replace('@', '').trim();
        
        if (jugadores[cleanUsername]) {
            console.log(`🔄 Reenganchando y LIMPIANDO historial completo para @${cleanUsername}`);
            jugadores[cleanUsername].vidas = 3;
            jugadores[cleanUsername].respondidas = []; // Asegura que empiece de cero preguntas respondidas
            jugadores[cleanUsername].combo = 0;
            jugadores[cleanUsername].puntos = 0; // Se resetea el score para el nuevo intento
            jugadores[cleanUsername].socketId = socket.id;
        } else {
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
        guardarRankingEnDisco(); 
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
        guardarRankingEnDisco(); 
        enviarRanking();
    });

    socket.on('reset_game', () => {
        const cleanUsername = socket.usernameClean;
        if (cleanUsername && jugadores[cleanUsername]) {
            console.log(`🧹 Reset manual forzado para @${cleanUsername}`);
            jugadores[cleanUsername].vidas = 3;
            jugadores[cleanUsername].respondidas = [];
            jugadores[cleanUsername].combo = 0;
            jugadores[cleanUsername].puntos = 0;
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
server.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
