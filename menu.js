document.getElementById('btnSingle').addEventListener('click', () => {
    window.location.href = 'game.html?role=single';
});

document.getElementById('btnHost').addEventListener('click', () => {
    window.location.href = 'game.html?role=host';
});

const btnJoin = document.getElementById('btnJoin');
const joinSection = document.getElementById('joinSection');
const btnJoinBack = document.getElementById('btnJoinBack');

btnJoin.addEventListener('click', () => {
    // Hide main buttons, show input
    document.querySelector('.menu-options').style.display = 'none';
    joinSection.style.display = 'flex';
});

btnJoinBack.addEventListener('click', () => {
    document.querySelector('.menu-options').style.display = 'grid'; // Grid or flex depending on css
    joinSection.style.display = 'none';
});

document.getElementById('btnJoinConfirm').addEventListener('click', () => {
    const id = document.getElementById('joinIdInput').value.trim();
    if (id) {
        window.location.href = `game.html?role=join&id=${encodeURIComponent(id)}`;
    }
});
