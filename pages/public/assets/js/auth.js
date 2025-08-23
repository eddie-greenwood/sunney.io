// Sunney.io Authentication Module
// Handles JWT tokens and authentication for all apps

class SunneyAuth {
    constructor() {
        this.token = localStorage.getItem('sunney_token');
        this.user = JSON.parse(localStorage.getItem('sunney_user') || '{}');
        this.authUrl = window.location.hostname === 'localhost' 
            ? 'http://localhost:8787' 
            : 'https://sunney-auth.eddie-37d.workers.dev';
        this.apiUrl = window.location.hostname === 'localhost'
            ? 'http://localhost:8788'
            : 'https://sunney-api.eddie-37d.workers.dev';
    }

    isAuthenticated() {
        return !!this.token;
    }

    async login(email, password) {
        try {
            const response = await fetch(`${this.authUrl}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            if (!response.ok) {
                throw new Error('Invalid credentials');
            }

            const data = await response.json();
            this.token = data.token;
            this.user = data.user;
            
            localStorage.setItem('sunney_token', this.token);
            localStorage.setItem('sunney_user', JSON.stringify(this.user));
            
            return data;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    async register(email, password, name) {
        try {
            const response = await fetch(`${this.authUrl}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password, name })
            });

            if (!response.ok) {
                throw new Error('Registration failed');
            }

            const data = await response.json();
            this.token = data.token;
            this.user = data.user;
            
            localStorage.setItem('sunney_token', this.token);
            localStorage.setItem('sunney_user', JSON.stringify(this.user));
            
            return data;
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        }
    }

    logout() {
        this.token = null;
        this.user = {};
        localStorage.removeItem('sunney_token');
        localStorage.removeItem('sunney_user');
        window.location.href = '/auth/login.html';
    }

    async verifyToken() {
        if (!this.token) return false;

        try {
            const response = await fetch(`${this.authUrl}/auth/verify`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            return response.ok;
        } catch (error) {
            console.error('Token verification error:', error);
            return false;
        }
    }

    getAuthHeaders() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
        };
    }

    async apiCall(endpoint, options = {}) {
        if (!this.isAuthenticated()) {
            window.location.href = '/auth/login.html';
            return;
        }

        const url = `${this.apiUrl}${endpoint}`;
        const config = {
            ...options,
            headers: {
                ...this.getAuthHeaders(),
                ...options.headers
            }
        };

        try {
            const response = await fetch(url, config);
            
            if (response.status === 401) {
                // Token expired or invalid
                this.logout();
                return;
            }

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API call error:', error);
            throw error;
        }
    }

    requireAuth() {
        if (!this.isAuthenticated()) {
            window.location.href = '/auth/login.html';
            return false;
        }
        return true;
    }

    displayUser() {
        if (this.user && this.user.name) {
            const userElements = document.querySelectorAll('.user-name');
            userElements.forEach(el => {
                el.textContent = this.user.name;
            });

            const emailElements = document.querySelectorAll('.user-email');
            emailElements.forEach(el => {
                el.textContent = this.user.email;
            });
        }
    }
}

// Initialize auth globally
window.sunneyAuth = new SunneyAuth();

// Check auth on page load
document.addEventListener('DOMContentLoaded', () => {
    // Skip auth check on login/register pages
    if (window.location.pathname.includes('/auth/')) {
        return;
    }

    // Require auth for all other pages
    if (!window.sunneyAuth.requireAuth()) {
        return;
    }

    // Display user info
    window.sunneyAuth.displayUser();

    // Add logout handlers
    const logoutButtons = document.querySelectorAll('.logout-btn');
    logoutButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            window.sunneyAuth.logout();
        });
    });
});