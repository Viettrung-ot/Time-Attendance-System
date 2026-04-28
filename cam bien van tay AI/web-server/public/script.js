const API_URL = '/api/logs';
let isLiveMode = true;
let liveInterval = null;

async function fetchLogs() {
    // Only fetch live logs if in live mode
    if (!isLiveMode) return;

    try {
        const response = await fetch(API_URL);
        const logs = await response.json();
        updateUI(logs);
    } catch (error) {
        console.error('Error fetching logs:', error);
    }
}

// History Logic
async function fetchHistory(dateString) {
    if (liveInterval) clearInterval(liveInterval); // Should rely on isLiveMode, but good safety
    isLiveMode = false;

    // Update UI Elements
    document.getElementById('logs-title').innerText = `History: ${dateString}`;
    document.getElementById('btn-view-live').style.display = 'inline-block';

    // Highlight selected day (handled in renderCalendar usually, or we can just re-render)

    try {
        // encoded date for URL
        const response = await fetch(`/api/history?date=${encodeURIComponent(dateString)}`);
        const logs = await response.json();

        // Use same UI update function but maybe different stats?
        // For simplicity, just update the table
        updateUI(logs, true); // true = history mode (don't update live stats if we don't want to)

    } catch (error) {
        console.error('Error fetching history:', error);
    }
}

function enableLiveMode() {
    isLiveMode = true;
    document.getElementById('logs-title').innerText = 'Recent Access Logs (Live)';
    document.getElementById('btn-view-live').style.display = 'none';
    fetchLogs(); // Fetch immediately

    // Re-render calendar to remove selection highlight
    renderCalendar(currentDate);
}

// Auth Check
if (!sessionStorage.getItem('isLoggedIn') && !window.location.href.includes('login.html')) {
    window.location.replace('login.html');
}

// Global Logs Data for Search/Export
let currentLogs = [];

// Helper to get name (Global)
const getUserName = (id) => {
    if (window.allUsers) {
        const user = window.allUsers.find(u => u.id == id);
        if (user && user.name) return user.name;
    }
    return `ID ${id}`;
};

// Helper to generate Avatar HTML
const getAvatarHTML = (name, id) => {
    let initials = "";
    if (name.startsWith("ID ")) {
        initials = `#${id}`;
    } else {
        const parts = name.split(' ');
        if (parts.length >= 2) {
            initials = parts[0][0] + parts[parts.length - 1][0];
        } else {
            initials = name.slice(0, 2);
        }
    }

    // Simple pseudo-random color based on ID
    const colorIndex = id % 5;
    return `<div class="user-avatar avatar-${colorIndex}">${initials}</div>`;
};


// Update UI
function updateUI(logs, isHistory = false) {
    currentLogs = logs; // Save for export/search
    renderLogsTable(logs);
    updateStats(logs, isHistory);
    updateChart(logs);
}

// Chart Logic
let chartInstance = null;
let currentChartMode = 'day';

async function setChartMode(mode) {
    currentChartMode = mode;

    // Update Button UI
    document.querySelectorAll('.btn-chart').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.btn-chart[onclick="setChartMode('${mode}')"]`).classList.add('active');

    // Fetch data if needed (for Month/Year we need more than just current 'logs' which is limit 50)
    // We'll call the new /api/stats endpoint
    try {
        let dataToProcess = [];
        if (mode === 'day') {
            // For 'Today', we can just use the current live logs or fetch fresh
            dataToProcess = currentLogs.length > 0 ? currentLogs : await (await fetch('/api/logs')).json();
        } else {
            const response = await fetch('/api/stats');
            dataToProcess = await response.json();
        }
        updateChart(dataToProcess, mode);
    } catch (e) {
        console.error("Error updating chart mode:", e);
    }
}

function updateChart(logs, mode = 'day') {
    const ctx = document.getElementById('activityChart');
    if (!ctx) return;

    let labels = [];
    let data = [];
    let labelText = 'Access Count';

    if (mode === 'day') {
        // Hourly (0-23)
        // Ensure we only count TODAY's logs for 'day' mode if the dataset is mixed
        const todayStr = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY

        const hours = Array(24).fill(0);
        logs.forEach(log => {
            if (log.date === todayStr) { // Strict filter for Day view
                try {
                    const h = parseInt(log.time.split(':')[0]);
                    if (!isNaN(h) && h >= 0 && h < 24) hours[h]++;
                } catch (e) { }
            }
        });
        labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
        data = hours;
        labelText = "Today's Activity";

    } else if (mode === 'month') {
        // Daily (1-31)
        // Group by Date 
        const currentMonth = new Date().getMonth(); // 0-11
        const currentYear = new Date().getFullYear();

        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const days = Array(daysInMonth).fill(0);

        logs.forEach(log => {
            try {
                // log.date is DD/MM/YYYY
                const [d, m, y] = log.date.split('/').map(Number);
                if (m - 1 === currentMonth && y === currentYear) {
                    if (d >= 1 && d <= daysInMonth) days[d - 1]++;
                }
            } catch (e) { }
        });

        labels = Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`);
        data = days;
        labelText = "This Month's Activity";

    } else if (mode === 'year') {
        // Monthly (Jan-Dec)
        const months = Array(12).fill(0);
        const currentYear = new Date().getFullYear();

        logs.forEach(log => {
            try {
                const [d, m, y] = log.date.split('/').map(Number);
                if (y === currentYear) {
                    if (m >= 1 && m <= 12) months[m - 1]++;
                }
            } catch (e) { }
        });

        labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        data = months;
        labelText = "This Year's Activity";
    }

    // Config
    const config = {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: labelText,
                data: data,
                backgroundColor: 'rgba(33, 150, 243, 0.6)',
                borderColor: 'rgba(33, 150, 243, 1)',
                borderWidth: 1,
                borderRadius: 4,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return `${context.raw} scans`;
                        }
                    }
                }
            }
        }
    };

    if (chartInstance) {
        chartInstance.destroy(); // Recreating is safer when swapping labels/data types entirely
    }
    chartInstance = new Chart(ctx, config);
}

function updateStats(logs, isHistory) {
    const totalEl = document.getElementById('stats-total');
    const lastIdEl = document.getElementById('stats-last-id');

    // Stats
    if (!isHistory && totalEl && lastIdEl) {
        if (logs.length > 0) {
            totalEl.innerText = logs.length;

            const lastLog = logs[0];
            const name = getUserName(lastLog.id);
            lastIdEl.innerText = name;
        } else {
            totalEl.innerText = '0';
            lastIdEl.innerText = '--';
        }
    } else if (isHistory) {
        if (totalEl) totalEl.innerText = `${logs.length} (History)`;
        if (lastIdEl) lastIdEl.innerText = '--';
    }
}

function renderLogsTable(logs) {
    const tbody = document.getElementById('logs-body');
    // Search only by User ID (or Name since they are linked)
    const filterText = document.getElementById('status-search') ? document.getElementById('status-search').value.toLowerCase().trim() : '';

    tbody.innerHTML = '';

    // Filter logs based on search input (ID or Name only)
    const filteredLogs = logs.filter(log => {
        if (!filterText) return true; // No filter

        const name = getUserName(log.id).toLowerCase();
        const idStr = String(log.id);

        // Exclude Time/Date from search
        return name.includes(filterText) || idStr.includes(filterText);
    });

    if (filteredLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">No Data Found</td></tr>';
        return;
    }

    filteredLogs.forEach(log => {
        let statusHtml = '<span class="status-success">On Time</span>';
        let displayName = getUserName(log.id);
        let avatar = getAvatarHTML(displayName, log.id);

        // ID 0 Check - Unknown Fingerprint
        if (parseInt(log.id) === 0) {
            displayName = '<span style="color: #f44336; font-weight: bold;">No Name</span>';
            avatar = `<div class="user-avatar" style="background-color: #f44336;">?</div>`;
            statusHtml = '<span style="color: #f44336; font-weight: bold; background: rgba(244, 67, 54, 0.1); padding: 4px 8px; border-radius: 4px;">No Data Found</span>';
        } else {
            try {
                const timeParts = log.time.split(':');
                if (timeParts.length >= 2) {
                    const hour = parseInt(timeParts[0]);
                    const minute = parseInt(timeParts[1]);
                    if (hour > 8 || (hour === 8 && minute > 0)) {
                        statusHtml = '<span class="status-late">Late</span>';
                    }
                }
            } catch (e) {
                console.error("Time parse error", e);
            }
        }

        // Combine Avatar + Name + ID
        const displayHtml = `
            <div style="display: flex; align-items: center;">
                ${avatar}
                <div>
                    <div style="font-weight: 500;">${displayName}</div>
                    ${parseInt(log.id) !== 0 && !displayName.startsWith('ID ') && !displayName.includes('No Name') ? `<div style="font-size:0.75rem; color:var(--text-muted);">ID: ${log.id}</div>` : ''}
                </div>
            </div>
        `;

        const row = `<tr>
            <td style="padding: 10px;">${displayHtml}</td>
            <td>${log.time}</td>
            <td>${log.date}</td>
            <td>${statusHtml}</td>
        </tr>`;
        tbody.innerHTML += row;
    });
}

// Search Listener
const searchInput = document.getElementById('status-search');
if (searchInput) {
    searchInput.addEventListener('input', () => {
        renderLogsTable(currentLogs);
    });
}

// Export to Excel (CSV)
function exportToExcel() {
    if (!currentLogs || currentLogs.length === 0) {
        showToast('No data to export', 'error');
        return;
    }

    // CSV Header
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "User Name,User ID,Time,Date,Status\n";

    // Data Rows
    currentLogs.forEach(log => {
        const name = getUserName(log.id);
        const status = (parseInt(log.time.split(':')[0]) > 8 || (parseInt(log.time.split(':')[0]) === 8 && parseInt(log.time.split(':')[1]) > 0)) ? "Late" : "On Time";
        csvContent += `"${name}",${log.id},${log.time},${log.date},${status}\n`;
    });

    // Create Download Link
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const dateStr = new Date().toISOString().split('T')[0];
    link.setAttribute("download", `attendance_logs_${dateStr}.csv`);
    document.body.appendChild(link); // Required for FF
    link.click();
    document.body.removeChild(link);

    showToast('Export successful!', 'success');
}


// Poll every 3 seconds
// Poll every 3 seconds
liveInterval = setInterval(fetchLogs, 3000);
// Poll every 3 seconds
liveInterval = setInterval(fetchLogs, 3000);
// fetchLogs(); // Removed: Handled by init() sequence

// Clock Function
function updateClock() {
    const now = new Date();
    // Format: 10:30:45 - 16/12/2025
    const timeString = now.toLocaleTimeString('en-GB');
    const dateString = now.toLocaleDateString('en-GB');

    const clockEl = document.getElementById('live-clock');
    if (clockEl) {
        clockEl.innerText = `${timeString} - ${dateString}`;
    }
}

// Start Clock

// Start Clock
setInterval(updateClock, 1000);
updateClock();

// --- Calendar Logic ---
const calendarMonthYear = document.getElementById('calendar-month-year');
const calendarGrid = document.getElementById('calendar-grid');
const prevMonthBtn = document.getElementById('prev-month');
const nextMonthBtn = document.getElementById('next-month');

let currentDate = new Date();

function renderCalendar(date) {
    const year = date.getFullYear();
    const month = date.getMonth();

    // Update Header
    if (calendarMonthYear) calendarMonthYear.innerText = new Date(year, month).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    if (!calendarGrid) return;

    // Clear days (keep weekdays)
    const weekdays = calendarGrid.querySelectorAll('.weekday');
    calendarGrid.innerHTML = '';
    weekdays.forEach(wd => calendarGrid.appendChild(wd));

    const firstDay = new Date(year, month, 1).getDay(); // 0 = Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Adjust for Monday start (0=Sun -> 6, 1=Mon -> 0)
    const startDayIndex = (firstDay === 0 ? 6 : firstDay - 1);

    // Empty slots
    for (let i = 0; i < startDayIndex; i++) {
        const emptyDiv = document.createElement('div');
        emptyDiv.classList.add('calendar-day', 'empty');
        calendarGrid.appendChild(emptyDiv);
    }

    // Days
    const today = new Date();
    for (let i = 1; i <= daysInMonth; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.classList.add('calendar-day');
        dayDiv.innerText = i;

        // Check if today
        if (i === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
            dayDiv.classList.add('today');
        }

        // Add click event for history
        dayDiv.addEventListener('click', () => {
            // Remove active class from all
            document.querySelectorAll('.calendar-day').forEach(el => el.classList.remove('selected-day'));
            dayDiv.classList.add('selected-day');

            // Format date: DD/MM/YYYY
            const dayStr = i < 10 ? `0${i}` : i;
            const monthStr = (month + 1) < 10 ? `0${month + 1}` : (month + 1);
            const dateQuery = `${dayStr}/${monthStr}/${year}`;

            fetchHistory(dateQuery);
        });

        calendarGrid.appendChild(dayDiv);
    }
}

if (prevMonthBtn)
    prevMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar(currentDate);
    });

if (nextMonthBtn)
    nextMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar(currentDate);
    });

// Initial Render
renderCalendar(currentDate);

// --- Theme & Navigation Logic ---


// --- User Management Logic ---

// Navigation Logic (Ensure this runs on all links with data-target)
const navLinks = document.querySelectorAll('.nav-link');
const views = document.querySelectorAll('.view-section');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        // Only prevent default if it has a target
        if (link.hasAttribute('data-target')) {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');

            // Remove active class from all links
            navLinks.forEach(l => l.classList.remove('active'));
            // Add active to clicked
            link.classList.add('active');

            // Hide all views
            views.forEach(view => view.style.display = 'none');
            // Show target view
            const targetView = document.getElementById(targetId);
            if (targetView) targetView.style.display = 'block';
        }
    });
});

// Modal Logic
const userModal = document.getElementById('user-modal');

function openUserModal() {
    if (userModal) userModal.style.display = 'block';
}

function closeUserModal() {
    if (userModal) userModal.style.display = 'none';
}

// Close modal if clicked outside
window.onclick = function (event) {
    if (event.target == userModal) {
        closeUserModal();
    }
}

// Fetch Users first, then Logs to ensure names are available
async function init() {
    await fetchUsers();
    fetchLogs(); // Initial log fetch
}
init();

// Fetch Users
async function fetchUsers() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        renderUsers(users);
        // After fetching users, re-render logs if they already exist (though init handles order)
        // But for subsequent updates, it's fine.
    } catch (error) {
        console.error('Error fetching users:', error);
    }
}


// Global variable to track editing
let currentEditingId = null;

// Render Users
function renderUsers(users) {
    // Store globally for lookup
    window.allUsers = users;

    const tbody = document.getElementById('users-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">No Users Found</td></tr>';
        return;
    }

    users.forEach(user => {
        const row = `<tr>
            <td style="text-align: center;">#${user.id}</td>
            <td>
                <div style="display: flex; align-items: center;">
                    ${getAvatarHTML(user.name, user.id)}
                    <div>
                        <div style="font-weight: 500;">${user.name}</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">${user.cccd || 'N/A'}</div>
                    </div>
                </div>
            </td>
            <td>${user.position || '--'}</td>
            <td>${user.gender || '--'}</td>
            <td style="text-align: center;">
                <div style="display: flex; gap: 8px; justify-content: center;">
                    <button onclick="editUser('${user.id}')" class="btn-icon edit" title="Edit">
                        <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button onclick="deleteUser('${user.id}')" class="btn-icon delete" title="Delete">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </td>
        </tr>`;
        tbody.innerHTML += row;
    });
}

// Edit User
function editUser(id) {
    const user = window.allUsers.find(u => u.id == id);
    if (!user) return;

    // Populate Form
    document.getElementById('user-id').value = user.id;
    document.getElementById('user-id').readOnly = true; // Cannot change ID when editing
    document.getElementById('user-name').value = user.name || '';
    document.getElementById('user-desc').value = user.desc || '';
    document.getElementById('user-position').value = user.position || '';
    document.getElementById('user-gender').value = user.gender || 'Male';
    document.getElementById('user-yob').value = user.yob || '';
    document.getElementById('user-cccd').value = user.cccd || '';
    document.getElementById('user-hometown').value = user.hometown || '';
    document.getElementById('user-address').value = user.address || '';

    // Set Editing Flag
    currentEditingId = id;

    // Update Modal Title (Optional)
    const modalTitle = document.querySelector('#user-modal h2');
    if (modalTitle) modalTitle.innerText = "Edit User";

    openUserModal();
}

// Toast Notification
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;

    // Better animation handling: pure CSS animation is tricky for removal from DOM.
    // Let's use JS for removal timing to be safe.
    toast.style.animation = 'slideIn 0.3s ease';
    toast.style.opacity = '1';

    container.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (container.contains(toast)) {
                container.removeChild(toast);
            }
        }, 500);
    }, 3000);
}

// Delete User
async function deleteUser(id) {
    // Simple Security Check
    const confirmCode = prompt("⚠️ Restricted Action\nPlease enter admin password to delete user:");
    if (confirmCode !== "admin123") { // Simple demo password
        if (confirmCode !== null) showToast("Wrong password! Action denied.", "error");
        return;
    }

    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
        const response = await fetch(`/api/users/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showToast('User deleted successfully', 'success');
            fetchUsers();
        } else {
            showToast('Error deleting user', 'error');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        showToast('Error deleting user: ' + error.message, 'error');
    }
}

// Handle Form Submission
const userForm = document.getElementById('user-form');
if (userForm) {
    userForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Get Values
        const userData = {
            id: document.getElementById('user-id').value,
            name: document.getElementById('user-name').value,
            desc: document.getElementById('user-desc').value,
            position: document.getElementById('user-position').value,
            gender: document.getElementById('user-gender').value,
            yob: document.getElementById('user-yob').value,
            cccd: document.getElementById('user-cccd').value,
            hometown: document.getElementById('user-hometown').value,
            address: document.getElementById('user-address').value
        };

        try {
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });

            if (response.ok) {
                showToast('User saved successfully', 'success');
                closeUserModal();
                fetchUsers(); // Refresh list

                // Reset Form and State
                userForm.reset();
                document.getElementById('user-id').readOnly = false;
                currentEditingId = null;
                const modalTitle = document.querySelector('#user-modal h2');
                if (modalTitle) modalTitle.innerText = "Register New User";

            } else {
                const data = await response.json();
                showToast('Error: ' + data.error, 'error');
            }
        } catch (error) {
            console.error('Error saving user:', error);
            showToast('Error saving user', 'error');
        }
    });
}


// Theme Toggle
const themeToggle = document.getElementById('theme-toggle');
// const body = document.body; // duplicate

// Check saved theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    themeToggle.checked = false; // Unchecked for Light Mode
} else {
    // Default is Dark Mode (checked)
    themeToggle.checked = true;
}

themeToggle.addEventListener('change', () => {
    if (themeToggle.checked) {
        // Dark Mode
        document.body.classList.remove('light-mode');
        localStorage.setItem('theme', 'dark');
    } else {
        // Light Mode
        document.body.classList.add('light-mode');
        localStorage.setItem('theme', 'light');
    }
});

// --- AI Chat Logic ---
function toggleChat() {
    const chatBox = document.getElementById('chat-box');
    chatBox.classList.toggle('chat-hidden');
    // Focus input if opening
    if (!chatBox.classList.contains('chat-hidden')) {
        setTimeout(() => document.getElementById('chat-input').focus(), 300);
    }
}

async function sendChatMessage() {
    const inputEl = document.getElementById('chat-input');
    const message = inputEl.value.trim();
    if (!message) return;

    // Add user message
    addMessage(message, 'user');
    inputEl.value = '';

    // Show loading
    const loadingId = addMessage('Đang phân tích dữ liệu...', 'bot');

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: message })
        });

        const data = await response.json();

        // Remove loading message
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        if (data.answer) {
            addMessage(data.answer, 'bot'); // Display markdown-like text as plain text for now, or use a mini parser
        } else {
            addMessage('Xin lỗi, tôi gặp lỗi khi xử lý yêu cầu.', 'bot');
        }

    } catch (error) {
        console.error('Chat error:', error);
        addMessage('Lỗi kết nối server.', 'bot');
    }
}

function handleChatInput(event) {
    if (event.key === 'Enter') {
        sendChatMessage();
    }
}

function addMessage(text, sender) {
    const chatMessages = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    msgDiv.classList.add(sender === 'user' ? 'user-message' : 'bot-message');

    // Simple ID for removal
    const id = 'msg-' + Date.now();
    msgDiv.id = id;

    // Convert newlines to <br> for basic formatting
    msgDiv.innerHTML = text.replace(/\n/g, '<br>');

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return id;
}

function logout() {
    sessionStorage.removeItem('isLoggedIn');
    window.location.replace('login.html');
}
