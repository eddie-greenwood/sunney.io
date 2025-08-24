// Authentication Worker - Handles user auth and JWT tokens
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { JWTCache } from './jwt-cache';

export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
  JWT_CACHE?: KVNamespace; // Optional for backward compatibility
  [key: string]: any;
}

const app = new Hono<{ Bindings: Env }>();

// CORS configuration
app.use('*', cors({
  origin: [
    'https://sunney.io', 
    'http://localhost:3000',
    'https://sunney-api.eddie-37d.workers.dev',
    'https://sunney-io.pages.dev'
  ],
  credentials: true
}));

// Schemas
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2)
});

// Health check
app.get('/health', (c) => {
  return c.json({ 
    status: 'healthy',
    service: 'sunney-auth',
    timestamp: new Date().toISOString()
  });
});

// Register endpoint
app.post('/auth/register', async (c) => {
  try {
    // Check if JWT_SECRET exists
    if (!c.env.JWT_SECRET) {
      console.error('JWT_SECRET not found in environment');
      return c.json({ error: 'Server configuration error: JWT_SECRET missing' }, 500);
    }
    
    const body = await c.req.json();
    const data = RegisterSchema.parse(body);
    
    // Check if user exists
    const existing = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(data.email).first();
    
    if (existing) {
      return c.json({ error: 'User already exists' }, 400);
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 10);
    
    // Create user
    const result = await c.env.DB.prepare(
      'INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, datetime("now")) RETURNING id'
    ).bind(data.email, passwordHash, data.name).first();
    
    if (!result || !result.id) {
      throw new Error('Failed to create user - no ID returned');
    }
    
    // Generate JWT
    const userId = String(result.id);
    const token = await generateJWT(userId, data.email, c.env.JWT_SECRET);
    
    // Store session
    await c.env.SESSIONS.put(`session:${userId}`, JSON.stringify({
      userId: userId,
      email: data.email,
      createdAt: new Date().toISOString()
    }), { expirationTtl: 86400 }); // 24 hours
    
    return c.json({
      token,
      user: {
        id: result.id,
        email: data.email,
        name: data.name
      }
    });
  } catch (error: any) {
    console.error('Register error:', error);
    console.error('Error stack:', error.stack);
    return c.json({ 
      error: 'Registration failed',
      details: error.message || 'Unknown error'
    }, 500);
  }
});

// Login endpoint
app.post('/auth/login', async (c) => {
  try {
    const body = await c.req.json();
    const data = LoginSchema.parse(body);
    
    // Get user
    const user = await c.env.DB.prepare(
      'SELECT id, email, password_hash, name FROM users WHERE email = ?'
    ).bind(data.email).first();
    
    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    
    // Verify password
    const valid = await bcrypt.compare(data.password, user.password_hash as string);
    if (!valid) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    
    // Generate JWT
    const token = await generateJWT(user.id as string, user.email as string, c.env.JWT_SECRET);
    
    // Store session
    await c.env.SESSIONS.put(`session:${user.id}`, JSON.stringify({
      userId: user.id,
      email: user.email,
      createdAt: new Date().toISOString()
    }), { expirationTtl: 86400 });
    
    return c.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Login failed' }, 500);
  }
});

// Verify token endpoint with caching
app.post('/auth/verify', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ valid: false }, 401);
  }
  
  const token = authHeader.substring(7);
  
  // Check cache first if available
  if (c.env.JWT_CACHE) {
    const cache = new JWTCache(c.env.JWT_CACHE);
    const cached = await cache.get(token);
    if (cached) {
      // Cache hit - return immediately
      return c.json({ 
        valid: true,
        userId: cached.userId,
        email: cached.email,
        cached: true // For monitoring
      });
    }
  }
  
  try {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    
    // Check session exists
    const session = await c.env.SESSIONS.get(`session:${payload.userId}`);
    if (!session) {
      return c.json({ valid: false }, 401);
    }
    
    // Cache the valid token
    if (c.env.JWT_CACHE) {
      const cache = new JWTCache(c.env.JWT_CACHE);
      await cache.set(token, {
        userId: payload.userId,
        email: payload.email
      });
    }
    
    return c.json({ 
      valid: true,
      userId: payload.userId,
      email: payload.email
    });
  } catch (error) {
    return c.json({ valid: false }, 401);
  }
});

// Logout endpoint
app.post('/auth/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const payload = await verifyJWT(token, c.env.JWT_SECRET);
      await c.env.SESSIONS.delete(`session:${payload.userId}`);
    } catch (error) {
      // Ignore errors on logout
    }
  }
  
  return c.json({ success: true });
});

// JWT utilities - simplified for Workers environment
async function generateJWT(userId: string, email: string, secret: string): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  const payload = {
    userId,
    email,
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
    iat: Math.floor(Date.now() / 1000)
  };
  
  // Use TextEncoder to handle UTF-8 properly
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(JSON.stringify(header));
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  
  // Convert to base64url
  const encodedHeader = btoa(String.fromCharCode(...headerBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
    
  const encodedPayload = btoa(String.fromCharCode(...payloadBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  const data = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );
  
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return `${data}.${encodedSignature}`;
}

async function verifyJWT(token: string, secret: string): Promise<any> {
  const [header, payload, signature] = token.split('.');
  
  const encoder = new TextEncoder();
  const data = encoder.encode(`${header}.${payload}`);
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  
  // Decode signature from base64url
  const normalizedSig = signature
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = (4 - normalizedSig.length % 4) % 4;
  const paddedSig = normalizedSig + '='.repeat(padding);
  const sigBytes = Uint8Array.from(atob(paddedSig), c => c.charCodeAt(0));
  
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data);
  
  if (!valid) {
    throw new Error('Invalid token');
  }
  
  // Decode payload
  const normalizedPayload = payload
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const payloadPadding = (4 - normalizedPayload.length % 4) % 4;
  const paddedPayload = normalizedPayload + '='.repeat(payloadPadding);
  
  return JSON.parse(atob(paddedPayload));
}

export default app;