const grid = document.getElementById("pokemonGrid");
const selectedPokemonCard = document.getElementById("selectedPokemonCard");
const statusText = document.getElementById("statusText");
const hostIdDisplay = document.getElementById("hostIdDisplay");
const btnMakeGuess = document.getElementById("btnMakeGuess");

// Q&A Elements
const qaControls = document.getElementById("qa-controls");
const questionTypeSelect = document.getElementById("questionTypeSelect");
const questionValueSelect = document.getElementById("questionValueSelect");
const btnAskQuestion = document.getElementById("btnAskQuestion");

// Chat Elements
const chatContainer = document.getElementById("chat-container");
const chatHistory = document.getElementById("chatHistory");
const chatInput = document.getElementById("chatInput");
const btnSendChat = document.getElementById("btnSendChat");

// Modals
const answerModal = document.getElementById("answerModal");
const modalQuestionText = document.getElementById("modalQuestionText");
const btnAnswerYes = document.getElementById("btnAnswerYes");
const btnAnswerNo = document.getElementById("btnAnswerNo");

const guessModal = document.getElementById("guessModal");
const guessPokemonSelect = document.getElementById("guessPokemonSelect");
const btnConfirmGuess = document.getElementById("btnConfirmGuess");
const btnCancelGuess = document.getElementById("btnCancelGuess");

const waitingModal = document.getElementById("waitingModal");
const waitingHostId = document.getElementById("waitingHostId");
const btnCancelHost = document.getElementById("btnCancelHost");

let allPokemonNames = [];
let currentSeed = null;
let gameState = "SELECTING"; // 'SELECTING' | 'PLAYING' | 'WAITING_OPPONENT' | 'FINISHED'
let peer = null;
let conn = null;
let myPeerId = null;
let isHost = false;
let isOpponentReady = false;
let isMyTurn = false;
let canAsk = false;

// Turn Management (v2.3)
let myPlayerIndex = 0; // Host = 1, Joiners = 2, 3, 4...
let currentTurnPlayerIndex = 1;

// Seeded Random Generator (Mulberry32)
function mulberry32(a) {
    return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// Fetch all pokemon names only once
// Fetch all pokemon names AND details
async function fetchPokemonData() {
    try {
        const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=151'); // Gen 1 (151)
        const data = await response.json();
        const results = data.results;

        // Note: Fetching details for all 151 might be slow. 
        // Better strategy: Select random 30, THEN fetch details for those 30.
        // But initGame needs the seed to select the SAME 30 for both players.
        // So we must have the list of names valid.

        allPokemonNames = results.map(p => p.name);

        // We will fetch details during render/init to avoid initial lag
        init();

    } catch (error) {
        console.error("Error fetching Pokemon:", error);
        alert("Error cargando Pokémon. Intenta recargar.");
    }
}

// Init Logic
function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const role = urlParams.get('role');
    const joinId = urlParams.get('id');

    if (role === 'single') {
        initGame(Math.floor(Math.random() * 1000000));
        statusText.textContent = "Modo: Un Jugador";
        gameState = "SELECTING";
    } else if (role === 'host') {
        isHost = true;
        initPeer(null);
    } else if (role === 'join' && joinId) {
        isHost = false;
        initPeer(joinId);
    } else {
        alert("Modo de juego inválido");
        window.location.href = 'index.html';
    }
}

let connections = []; // Array for Host to store all connections
// conn is used for Joiner (single connection) OR for Host to reference a specific interaction? 
// Better: Host uses 'connections', Joiner uses 'conn'.

function initPeer(destId) {
    peer = new Peer();

    peer.on('open', (id) => {
        myPeerId = id;
        console.log('My ID: ' + id);

        if (isHost) {
            // Generate seed and initialize Host's board immediately
            const seed = Math.floor(Math.random() * 1000000);
            initGame(seed);

            myPlayerIndex = 1; // Host is always 1
            statusText.textContent = "Eres el Anfitrión (Jugador 1)";

            showWaitingModal();
        } else if (destId) {
            connectToPeer(destId);
        }
    });

    peer.on('connection', (c) => {
        // HOST Logic: Accept multiple connections
        if (!isHost) {
            // If I am a Joiner, I shouldn't accept connections?
            // Or maybe P2P Mesh? We are doing Star.
            c.close();
            return;
        }

        connections.push(c);

        // Assign Player ID (Host is 1, so first connection is 2)
        const newPlayerIndex = connections.length + 1;
        c.on('open', () => {
            c.send({ type: 'ASSIGN_ID', id: newPlayerIndex });
            if (currentSeed) c.send({ type: 'SEED', value: currentSeed });
        });

        setupHostConnection(c);

        statusText.textContent = `Jugadores conectados: ${connections.length + 1}`; // +1 is Host

        // Notify others?
        broadcast({ type: 'CHAT', message: "Nuevo jugador se ha unido (Jugador " + newPlayerIndex + ")!" }, c);
    });

    peer.on('error', (err) => {
        console.error(err);
        alert("Error de conexión: " + err.type);
    });
}

function showWaitingModal() {
    waitingModal.style.display = 'flex';
    waitingHostId.textContent = myPeerId;
    waitingHostId.onclick = () => {
        navigator.clipboard.writeText(myPeerId);
        alert("¡Copiado!");
    };

    // Add Start Button for Host
    let btnStart = document.getElementById("btnHostStartGame");
    if (!btnStart) {
        btnStart = document.createElement("button");
        btnStart.id = "btnHostStartGame";
        btnStart.textContent = "Iniciar Partida";
        btnStart.className = "neon-button";
        btnStart.style.marginTop = "15px";
        btnStart.onclick = () => {
            if (connections.length > 0) {
                // Close Lobby and Allow Selection
                waitingModal.style.display = 'none';
                broadcast({ type: 'LOBBY_CLOSED' });
                alert("¡Lobby cerrado! Selecciona tu personaje.");
            } else {
                alert("Esperando a que se unan jugadores...");
            }
        };
        waitingModal.querySelector('.modal-content').appendChild(btnStart);
    }
}

btnCancelHost.onclick = () => {
    window.location.href = 'index.html';
};

function connectToPeer(destId) {
    statusText.textContent = "Intentando conectar con " + destId + "...";
    conn = peer.connect(destId, {
        reliable: true
    });

    // Timeout check
    const connectionTimeout = setTimeout(() => {
        if (!conn || !conn.open) {
            statusText.textContent = "La conexión está tardando...";
            // alert("La conexión está tardando. Verifica el ID o intenta de nuevo.");
        }
    }, 5000);

    conn.on('open', () => {
        clearTimeout(connectionTimeout);
        statusText.textContent = "¡Conectado! Esperando datos...";
        console.log("Connected to: " + destId);
    });

    conn.on('error', (err) => {
        console.error("Connection Error: ", err);
        alert("Error en la conexión con el Host.");
    });

    setupJoinerConnection();
}

// HOST: Setup listeners for a client
function setupHostConnection(c) {
    c.on('open', () => {
        // Send Seed to new player
        if (currentSeed) {
            c.send({ type: 'SEED', value: currentSeed });
        }
    });

    c.on('data', (data) => {
        // Host receives data.
        // 1. Handle it locally
        handleData(data, c);

        // 2. Relay/Broadcast (Star Topology)
        // If CHAT, send to everyone else
        if (data.type === 'CHAT') {
            broadcast(data, c);
        }
        // If Game Action (QUESTION, ANSWER, etc), logic might differ
        // For now, simple relay for everything relevant
        if (['QUESTION', 'ANSWER', 'GUESS', 'CORRECT_GUESS', 'LOSE'].includes(data.type)) {
            broadcast(data, c);
        }
    });

    c.on('close', () => {
        connections = connections.filter(conn => conn !== c);
        statusText.textContent = `Jugadores conectados: ${connections.length + 1}`;
        broadcast({ type: 'CHAT', message: "Un jugador se ha desconectado." });
    });
}

// JOINER: Setup listener for Host
function setupJoinerConnection() {
    conn.on('open', () => {
        statusText.textContent = "¡Conectado!";
        chatContainer.style.display = 'flex';
        qaControls.style.display = 'block';
    });

    conn.on('data', (data) => handleData(data));

    conn.on('close', () => {
        alert("¡Conexión Perdida!");
        window.location.href = 'index.html';
    });
}

function broadcast(data, excludeConn = null) {
    connections.forEach(c => {
        if (c !== excludeConn && c.open) {
            c.send(data);
        }
    });
}

// Old setupConnection removed.

function handleData(data) {
    if (data.type === 'SEED') {
        initGame(data.value);
    }
    if (data.type === 'CHAT') {
        appendChatMessage("Oponente", data.message);
        // Could add notification sound here
    }
    if (data.type === 'READY') {
        appendChatMessage("Sistema", "¡Un jugador está listo!");

        if (isHost) {
            readyCount++;
            const totalPlayers = connections.length + 1;

            if (readyCount >= totalPlayers) {
                broadcast({ type: 'START_GAME' });
                startMultiplayerGame();

                // Initialize Turn Cycle (Player 1 starts)
                setTimeout(() => {
                    const turnData = { type: 'NEXT_TURN', playerIndex: 1 };
                    broadcast(turnData);
                    handleData(turnData);
                }, 1000);
            } else {
                appendChatMessage("Sistema", "Esperando a " + (totalPlayers - readyCount) + " jugadores más...");
            }
        }
    }
    if (data.type === 'QUESTION') {
        currentIncomingQuestionData = data;
        showAnswerModal(data.text);
        appendChatMessage("Oponente", "Preguntó: " + data.text);
    }
    if (data.type === 'ANSWER') {
        appendChatMessage("Oponente", "Respondió: " + data.response + " (a: " + data.originalQuestion + ")");

        if (data.category && data.value) {
            applyAutoDiscard(data.category, data.value, data.response);
        }

        endTurn();
    }
    if (data.type === 'ASSIGN_ID') {
        myPlayerIndex = data.id;
        console.log("My Player Index: " + myPlayerIndex);
        statusText.textContent = "Conectado como Jugador " + myPlayerIndex;
    }
    if (data.type === 'NEXT_TURN') {
        currentTurnPlayerIndex = data.playerIndex;

        if (currentTurnPlayerIndex === myPlayerIndex) {
            isMyTurn = true;
            canAsk = true;
            enableAskControls();
            appendChatMessage("Sistema", "¡ES TU TURNO!");
            // Browser notification?
        } else {
            isMyTurn = false;
            canAsk = false;
            disableAskControls();
            appendChatMessage("Sistema", "Turno del Jugador " + currentTurnPlayerIndex);
        }
    }
    if (data.type === 'TURN_PASS') {
        // Only Host handles TURN_PASS to calculate next turn
        if (isHost) {
            advanceTurn();
        }
    }
    if (data.type === 'GUESS') {
        handleOpponentGuess(data.pokemon);
    }
    if (data.type === 'CORRECT_GUESS') {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        setTimeout(() => alert("¡GANASTE! ¡Adivinaste correctamente!"), 500);
        gameState = "FINISHED";
    }
    if (data.type === 'LOSE') {
        appendChatMessage("Sistema", "Tu respuesta " + data.pokemon + " fue INCORRECTA. Cambio de turno.");
        endTurn();
    }
}

function applyAutoDiscard(category, value, response) {
    const isYes = response === "SÍ" || response === "YES";
    const gridCards = document.querySelectorAll(".grid .card");
    const targetValue = value.toLowerCase();

    const colorMap = {
        "Rojo": "red", "Azul": "blue", "Amarillo": "yellow", "Verde": "green",
        "Negro": "black", "Marrón": "brown", "Morado": "purple", "Gris": "gray", "Blanco": "white", "Rosa": "pink"
    };
    const typeMap = {
        "Fuego": "fire", "Agua": "water", "Planta": "grass", "Eléctrico": "electric", "Hielo": "ice",
        "Lucha": "fighting", "Veneno": "poison", "Tierra": "ground", "Volador": "flying", "Psíquico": "psychic",
        "Bicho": "bug", "Roca": "rock", "Fantasma": "ghost", "Dragón": "dragon", "Acero": "steel", "Siniestro": "dark", "Hada": "fairy"
    };

    const apiValue = category === "color" ? (colorMap[value] || targetValue) : (typeMap[value] || targetValue);

    gridCards.forEach(card => {
        if (card.classList.contains("defeated")) return;

        let match = false;
        if (category === "type") {
            const types = JSON.parse(card.dataset.types || "[]");
            match = types.includes(apiValue);
        } else if (category === "color") {
            const color = card.dataset.color || "";
            match = color === apiValue;
        }

        if (isYes) {
            if (!match) card.classList.add("defeated");
        } else {
            if (match) card.classList.add("defeated");
        }
    });
}

// Cache for pokemon details
const pokemonDetails = {};

async function getPokemonDetails(name) {
    if (pokemonDetails[name]) return pokemonDetails[name];
    try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name}`);
        const data = await res.json();

        // Get Species for Color
        const resSpecies = await fetch(data.species.url);
        const dataSpecies = await resSpecies.json();

        const details = {
            name: name,
            types: data.types.map(t => t.type.name), // e.g., ["fire", "flying"]
            color: dataSpecies.color.name, // e.g., "red"
            sprite: data.sprites.front_default || `https://img.pokemondb.net/artwork/large/${name}.jpg`
        };
        pokemonDetails[name] = details;
        return details;
    } catch (e) {
        console.error("Error fetching details for " + name, e);
        return { name: name, types: [], color: "unknown" };
    }
}

function initGame(seed) {
    currentSeed = seed;
    gameState = "SELECTING";
    selectedPokemonCard.innerHTML = '<div class="placeholder-text">?</div>';
    selectedPokemonCard.className = "card placeholder-card";

    const rng = mulberry32(seed);
    const shuffled = [...allPokemonNames];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const selectedPokemons = shuffled.slice(0, 30); // 30 cards
    renderGrid(selectedPokemons);
}

async function renderGrid(pokemons) {
    grid.innerHTML = "";
    // Render placeholders first? Or just render as we go? 
    // Render basic cards first, then populate details asynchronously to feel fast.

    for (const name of pokemons) {
        const card = document.createElement("div");
        card.classList.add("card");
        card.dataset.name = name; // Store name for logic

        // Initial state
        card.innerHTML = `
            <div class="loading-spinner">...</div>
            <div class="name">${name}</div>
        `;
        grid.appendChild(card);

        // Fetch details
        getPokemonDetails(name).then(details => {
            // Store attributes in dataset for easy filtering
            card.dataset.types = JSON.stringify(details.types);
            card.dataset.color = details.color;

            card.innerHTML = ""; // Clear loader

            const img = document.createElement("img");
            img.src = `https://img.pokemondb.net/artwork/large/${name}.jpg`;
            img.alt = name;
            img.loading = "lazy";
            img.onerror = function () { this.src = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png"; };

            const label = document.createElement("div");
            label.classList.add("name");
            label.textContent = name.replace(/-/g, ' ');

            card.appendChild(img);
            card.appendChild(label);
        });

        card.addEventListener("click", () => {
            if (gameState === "SELECTING") {
                selectPokemon(name);
            } else if (gameState === "PLAYING" || gameState === "FINISHED") {
                card.classList.toggle("defeated");
            }
        });
    }
}

function selectPokemon(name) {
    // gameState = "PLAYING"; // Don't set PLAYING yet! Wait for all.
    gameState = "WAITING_OTHERS";

    // Update Sidebar
    selectedPokemonCard.className = "card";
    selectedPokemonCard.innerHTML = "";
    const img = document.createElement("img");
    img.src = `https://img.pokemondb.net/artwork/large/${name}.jpg`;
    img.alt = name;
    const label = document.createElement("div");
    label.classList.add("name");
    label.textContent = name.replace(/-/g, ' ').toUpperCase();
    selectedPokemonCard.appendChild(img);
    selectedPokemonCard.appendChild(label);

    if (conn || isHost) { // isHost check important if Host hasn't "connected" to self
        // Send READY to others (or just process if Host)
        if (isHost) {
            readyCount++;
            if (readyCount >= connections.length + 1) {
                broadcast({ type: 'START_GAME' });
                startMultiplayerGame();

                // Initialize Turn Cycle (Player 1 starts)
                // Wait slightly to ensure START_GAME is processed
                setTimeout(() => {
                    const turnData = { type: 'NEXT_TURN', playerIndex: 1 }; // Always start with Host (P1)
                    broadcast(turnData);
                    handleData(turnData);
                }, 1000);

            } else {
                appendChatMessage("Sistema", "Esperando a los demás jugadores...");
            }
        } else {
            conn.send({ type: 'READY' });
            appendChatMessage("Sistema", "Has seleccionado tu Pokémon. Esperando a los demás...");
        }
    } else {
        // Single player
        document.getElementById("btnMakeGuess").style.display = "block";
    }
}

function startMultiplayerGame() {
    gameState = "PLAYING";
    appendChatMessage("System", "Both players ready! Start guessing!");

    if (isHost) {
        isMyTurn = true;
        canAsk = true;
        enableAskControls();
        appendChatMessage("System", "You go first!");
    } else {
        isMyTurn = false;
        canAsk = false;
        disableAskControls();
        appendChatMessage("System", "Opponent goes first.");
    }

    document.getElementById("btnMakeGuess").style.display = "block";
}

// Q&A Logic
const qaOptions = {
    "type": ["Normal", "Fire", "Water", "Grass", "Electric", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Steel", "Dark", "Fairy"],
    "color": ["Red", "Blue", "Yellow", "Green", "Black", "Brown", "Purple", "Gray", "White", "Pink"],
    "stage": ["Basic", "Stage 1", "Stage 2"]
};

function updateQuestionValues() {
    const type = questionTypeSelect.value;
    const values = qaOptions[type];
    questionValueSelect.innerHTML = "";
    values.forEach(val => {
        const option = document.createElement("option");
        option.value = val;
        option.textContent = val;
        questionValueSelect.appendChild(option);
    });
}
questionTypeSelect.addEventListener("change", updateQuestionValues);
updateQuestionValues();

btnAskQuestion.addEventListener("click", () => {
    if (!conn && !isHost) { alert("¡No estás conectado!"); return; }
    if (!canAsk) {
        if (isHost && gameState === "SELECTING") {
            alert("El juego no ha comenzado.");
        } else {
            alert("¡Espera tu turno!");
        }
        return;
    }

    const type = questionTypeSelect.value;
    const val = questionValueSelect.value;
    const category = type === "type" ? "Type" : (type === "color" ? "Color" : "Evolution");
    const questionText = `Is it ${val} ${category}?`;

    const qData = { type: 'QUESTION', text: questionText, category: type, value: questionValueSelect.value }; // Use raw value? No send logic is below. Wait.
    // Replicating logic from before but fixing the send.

    // Fix: We need to send structured data as per my previous fix.
    // Oh wait, line 507 was `conn.send`.

    const sendData = {
        type: 'QUESTION',
        text: questionText,
        category: type,
        value: val // English value
    };

    if (isHost) {
        broadcast(sendData);
        // Host doesn't need to handle QUESTION for self (as answerer), but for chat log yes.
    } else {
        conn.send(sendData);
    }

    appendChatMessage("Tú", "Preguntaste: " + questionText);

    canAsk = false;
    disableAskControls();
});

function disableAskControls() {
    btnAskQuestion.disabled = true;
    btnAskQuestion.classList.add("disabled");
    btnAskQuestion.textContent = "Esperando al Oponente...";
}
function enableAskControls() {
    btnAskQuestion.disabled = false;
    btnAskQuestion.classList.remove("disabled");
    btnAskQuestion.textContent = "Preguntar";
}

let currentIncomingQuestionData = null;

function showAnswerModal(question) {
    modalQuestionText.textContent = "El oponente pregunta: " + question;
    answerModal.style.display = "flex";
}
btnAnswerYes.addEventListener("click", () => sendAnswer("SÍ"));
btnAnswerNo.addEventListener("click", () => sendAnswer("NO"));

function sendAnswer(response) {
    if (!conn && !isHost) return;

    const answerData = {
        type: 'ANSWER',
        response: response,
        originalQuestion: currentIncomingQuestionData ? currentIncomingQuestionData.text : "",
        category: currentIncomingQuestionData ? currentIncomingQuestionData.category : null,
        value: currentIncomingQuestionData ? currentIncomingQuestionData.value : null
    };

    if (isHost) {
        broadcast(answerData); // Host broadcasts answer to all
        // Also apply auto-discard for Host self?
        if (answerData.category && answerData.value) {
            applyAutoDiscard(answerData.category, answerData.value, answerData.response);
        }
    } else {
        conn.send(answerData);
    }

    appendChatMessage("Tú", "Respondiste: " + response);
    answerModal.style.display = "none";
}

function endTurn() {
    canAsk = false;
    disableAskControls();

    if (isHost) {
        // If Host ends turn, they advance it directly
        advanceTurn();
    } else {
        // Joiner sends request to Host
        conn.send({ type: 'TURN_PASS' });
    }
    // appendChatMessage("Sistema", "Fin del turno."); // Handled by NEXT_TURN broadcast
}

function advanceTurn() {
    if (!isHost) return;

    // Cycle turns: 1 -> 2 -> ... -> N -> 1
    const totalPlayers = connections.length + 1;
    currentTurnPlayerIndex++;
    if (currentTurnPlayerIndex > totalPlayers) {
        currentTurnPlayerIndex = 1;
    }

    // Broadcast new turn
    const turnData = { type: 'NEXT_TURN', playerIndex: currentTurnPlayerIndex };
    broadcast(turnData);
    handleData(turnData); // Host handles it for self
}

// Guessing Logic
btnMakeGuess.addEventListener('click', () => {
    guessPokemonSelect.innerHTML = "";
    allPokemonNames.sort().forEach(name => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        guessPokemonSelect.appendChild(option);
    });
    guessModal.style.display = "block";
});
btnCancelGuess.addEventListener('click', () => guessModal.style.display = "none");
btnConfirmGuess.addEventListener('click', () => {
    const guess = guessPokemonSelect.value;
    if (conn || isHost) {
        const guessData = { type: 'GUESS', pokemon: guess };

        if (isHost) broadcast(guessData);
        else conn.send(guessData);

        appendChatMessage("Tú", "Adivinaste: " + guess);
        guessModal.style.display = "none";
    }
});

function handleOpponentGuess(guessedName) {
    const myPokemonName = selectedPokemonCard.querySelector('.name').textContent.toLowerCase();
    if (guessedName.toLowerCase() === myPokemonName) {
        conn.send({ type: 'CORRECT_GUESS' });
        alert("¡Perdiste! El oponente adivinó " + guessedName);
        gameState = "FINISHED";
    } else {
        conn.send({ type: 'LOSE', pokemon: guessedName });
        appendChatMessage("Sistema", "El oponente adivinó " + guessedName + " - ¡INCORRECTO!");
        isMyTurn = true;
        canAsk = true;
        enableAskControls();
        appendChatMessage("Sistema", "¡Tu Turno!");
    }
}

// Chat Logic
function appendChatMessage(sender, message) {
    const div = document.createElement("div");
    div.classList.add("chat-message");
    if (sender === "Tú") div.classList.add("self");
    else if (sender === "Oponente") div.classList.add("opponent");
    else div.classList.add("system");
    div.textContent = `${sender}: ${message}`;
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}
btnSendChat.addEventListener('click', sendChat);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;

    const msgData = { type: 'CHAT', message: text };

    if (isHost) {
        broadcast(msgData);
    } else if (conn) {
        conn.send(msgData);
    } else {
        return;
    }

    appendChatMessage("Tú", text);
    chatInput.value = "";
}

document.getElementById('btnExit').addEventListener('click', () => {
    window.location.href = 'index.html';
});

// Start
fetchPokemonData();
