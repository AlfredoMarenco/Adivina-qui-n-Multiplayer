const grid = document.getElementById("pokemonGrid");
const seedInput = document.getElementById("seedInput");
const btnLoad = document.getElementById("btnLoad");
const btnRandom = document.getElementById("btnRandom");
const currentSeedDisplay = document.getElementById("currentSeedDisplay");
const btnCopy = document.getElementById("btnCopy");
const selectedPokemonCard = document.getElementById("selectedPokemonCard");

let allPokemonNames = [];
let currentSeed = null;
let gameState = "SELECTING"; // 'SELECTING' | 'PLAYING' | 'WAITING_OPPONENT'
let peer = null;
let conn = null;
let myPeerId = null;
let isHost = false;
let isOpponentReady = false;



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
async function fetchPokemonData() {
    try {
        const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1000');
        const data = await response.json();
        allPokemonNames = data.results.map(p => p.name);

        // Initial load with random seed only if not joining game
        if (!conn) {
            initGame(Math.floor(Math.random() * 1000000));
        }

    } catch (error) {
        console.error("Error fetching Pokemon:", error);
        alert("Error cargando Pokémon. Intenta recargar la página.");
    }
}

function initGame(seed) {
    currentSeed = seed;
    currentSeedDisplay.textContent = `Seed: ${seed}`;
    seedInput.value = "";

    // Reset Game State
    gameState = "SELECTING";
    isOpponentReady = false;
    selectedPokemonCard.innerHTML = '<div class="placeholder-text">?</div>';

    selectedPokemonCard.className = "card placeholder-card";

    // Setup RNG
    const rng = mulberry32(seed);

    // Shuffle and pick 30
    // Fisher-Yates shuffle but using our seeded rng
    const shuffled = [...allPokemonNames];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const selectedPokemons = shuffled.slice(0, 30);
    renderGrid(selectedPokemons);

    if (conn && isHost) {
        conn.send({ type: 'SEED', value: seed });
    }
}

function renderGrid(pokemons) {
    grid.innerHTML = "";
    pokemons.forEach(name => {
        const card = document.createElement("div");
        card.classList.add("card");

        const img = document.createElement("img");
        // Prefer pokemondb for consistency, fallback to official artwork if needed (names match usually)
        img.src = `https://img.pokemondb.net/artwork/large/${name}.jpg`;
        img.alt = name;
        img.loading = "lazy";

        // Add error handling for images
        img.onerror = function () {
            this.src = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png"; // Fallback placeholder
        };

        const label = document.createElement("div");
        label.classList.add("name");
        label.textContent = name.replace(/-/g, ' ');

        card.appendChild(img);
        card.appendChild(label);

        card.addEventListener("click", () => {
            if (gameState === "SELECTING") {
                selectPokemon(name);
            } else {
                card.classList.toggle("defeated");
            }
        });

        grid.appendChild(card);
    });
}

function selectPokemon(name) {
    gameState = "PLAYING";

    // Update Sidebar Card
    selectedPokemonCard.className = "card"; // Remove placeholder class
    selectedPokemonCard.innerHTML = ""; // Clear placeholder

    const img = document.createElement("img");
    img.src = `https://img.pokemondb.net/artwork/large/${name}.jpg`;
    img.alt = name;

    const label = document.createElement("div");
    label.classList.add("name");
    label.textContent = name.replace(/-/g, ' ').toUpperCase();

    selectedPokemonCard.appendChild(img);
    selectedPokemonCard.appendChild(label);

    if (conn) {
        conn.send({ type: 'READY' });
        appendChatMessage("System", "You selected your Pokémon. Waiting for opponent...");

        if (isOpponentReady) {
            appendChatMessage("System", "Both players ready! Start guessing!");
        }
    }

}

// Event Listeners
btnLoad.addEventListener('click', () => {
    const seed = parseInt(seedInput.value);
    if (!isNaN(seed)) {
        initGame(seed);
    } else {
        alert("Por favor ingresa un número válido como seed.");
    }
});

btnRandom.addEventListener('click', () => {
    initGame(Math.floor(Math.random() * 1000000));
});

btnCopy.addEventListener('click', () => {
    if (currentSeed !== null) {
        navigator.clipboard.writeText(currentSeed).then(() => {
            const originalText = btnCopy.textContent;
            btnCopy.textContent = "✅";
            setTimeout(() => btnCopy.textContent = originalText, 1500);
        });
    }
});


// Multiplayer Logic
const btnHost = document.getElementById("btnHost");
const btnJoin = document.getElementById("btnJoin");
const joinInput = document.getElementById("joinInput");
const statusText = document.getElementById("statusText");
const hostIdDisplay = document.getElementById("hostIdDisplay");
const chatContainer = document.getElementById("chat-container");
const chatHistory = document.getElementById("chatHistory");
const chatInput = document.getElementById("chatInput");
const btnSendChat = document.getElementById("btnSendChat");

function initPeer() {
    peer = new Peer();

    peer.on('open', (id) => {
        myPeerId = id;
        console.log('My ID: ' + id);
    });

    peer.on('connection', (c) => {
        // Host receives connection
        if (conn) {
            c.close(); // Only one peer allowed
            return;
        }
        conn = c;
        isHost = true;
        statusText.textContent = "Status: Connected to " + conn.peer;
        setupConnection();
    });

    peer.on('error', (err) => {
        console.error(err);
        statusText.textContent = "Error: " + err.type;
    });
}

btnHost.addEventListener('click', () => {
    if (!peer) initPeer();
    // Wait for ID if not ready
    if (myPeerId) {
        showHostId();
    } else {
        peer.on('open', showHostId);
    }
});

function showHostId() {
    hostIdDisplay.textContent = myPeerId;
    hostIdDisplay.style.display = 'block';
    statusText.textContent = "Waiting for opponent to join...";
    hostIdDisplay.onclick = () => {
        navigator.clipboard.writeText(myPeerId);
        alert("ID Copied!");
    };
}

btnJoin.addEventListener('click', () => {
    const destId = joinInput.value.trim();
    if (!destId) return;

    if (!peer) initPeer(); // Should probably init peer earlier, but this works

    // Slight delay to ensure peer is ready if we just inited
    if (peer.id) {
        connectToPeer(destId);
    } else {
        peer.on('open', () => connectToPeer(destId));
    }
});

function connectToPeer(destId) {
    conn = peer.connect(destId);
    isHost = false;
    statusText.textContent = "Connecting...";
    setupConnection();
}

function setupConnection() {
    conn.on('open', () => {
        statusText.textContent = "Status: Connected";
        hostIdDisplay.style.display = 'none';
        chatContainer.style.display = 'flex';
        document.getElementById("qa-controls").style.display = 'block';
        document.getElementById("multiplayer-controls").querySelector(".join-container").style.display = 'none';
        btnHost.style.display = 'none';

        // If Host, send current seed
        if (isHost && currentSeed) {
            conn.send({ type: 'SEED', value: currentSeed });
        }
    });

    conn.on('data', (data) => {
        handleData(data);
    });

    conn.on('close', () => {
        statusText.textContent = "Status: Disconnected";
        statusText.textContent = "Status: Disconnected";
        conn = null;
        chatContainer.style.display = 'none';
        document.getElementById("qa-controls").style.display = 'none';
        alert("Connection lost!");
    });
}

function handleData(data) {
    if (data.type === 'SEED') {
        initGame(data.value);
        appendChatMessage("System", "Game Synced with Host!");
    }
    if (data.type === 'CHAT') {
        appendChatMessage("Opponent", data.message);
    }
    if (data.type === 'READY') {
        isOpponentReady = true;
        appendChatMessage("System", "Opponent is ready!");
        if (gameState === "PLAYING") {
            appendChatMessage("System", "Both players ready! Start guessing!");
        }
    }
    if (data.type === 'QUESTION') {
        showAnswerModal(data.text);
        appendChatMessage("Opponent", "Asked: " + data.text);
    }
    if (data.type === 'ANSWER') {
        appendChatMessage("Opponent", "Answered: " + data.response + " (to: " + data.originalQuestion + ")");
    }

}

// Chat Functions
function appendChatMessage(sender, message) {
    const div = document.createElement("div");
    div.classList.add("chat-message");

    if (sender === "You") div.classList.add("self");
    else if (sender === "Opponent") div.classList.add("opponent");
    else div.classList.add("system");

    div.textContent = `${sender}: ${message}`;
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

btnSendChat.addEventListener('click', sendChat);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
});

function sendChat() {
    const text = chatInput.value.trim();
    if (!text || !conn) return;

    conn.send({ type: 'CHAT', message: text });
    appendChatMessage("You", text);
    chatInput.value = "";
}


// Q&A System Logic
const questionTypeSelect = document.getElementById("questionTypeSelect");
const questionValueSelect = document.getElementById("questionValueSelect");
const btnAskQuestion = document.getElementById("btnAskQuestion");
const answerModal = document.getElementById("answerModal");
const modalQuestionText = document.getElementById("modalQuestionText");
const btnAnswerYes = document.getElementById("btnAnswerYes");
const btnAnswerNo = document.getElementById("btnAnswerNo");

const qaOptions = {
    "type": ["Normal", "Fire", "Water", "Grass", "Electric", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Steel", "Dark", "Fairy"],
    "color": ["Red", "Blue", "Yellow", "Green", "Black", "Brown", "Purple", "Gray", "White", "Pink"],
    "stage": ["Basic", "Stage 1", "Stage 2"]
};

// Populate initial dropdown
updateQuestionValues();

questionTypeSelect.addEventListener("change", updateQuestionValues);

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

btnAskQuestion.addEventListener("click", () => {
    if (!conn) {
        alert("Not connected!");
        return;
    }
    const type = questionTypeSelect.value;
    const val = questionValueSelect.value;
    const category = type === "type" ? "Type" : (type === "color" ? "Color" : "Evolution");

    const questionText = `Is it ${val} ${category}?`;

    conn.send({ type: 'QUESTION', text: questionText });
    appendChatMessage("You", "Asked: " + questionText);
});

let currentIncomingQuestion = "";

function showAnswerModal(question) {
    currentIncomingQuestion = question;
    modalQuestionText.textContent = "Opponent asks: " + question;
    answerModal.style.display = "flex";
}

btnAnswerYes.addEventListener("click", () => sendAnswer("YES"));
btnAnswerNo.addEventListener("click", () => sendAnswer("NO"));

function sendAnswer(response) {
    if (!conn) return;
    conn.send({
        type: 'ANSWER',
        response: response,
        originalQuestion: currentIncomingQuestion
    });
    appendChatMessage("You", "Answered: " + response);
    answerModal.style.display = "none";
}


// Start
fetchPokemonData();
