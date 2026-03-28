"use client";

import React, { useState } from 'react';

interface LoginPageProps {
  onLogin: (username: string, password: string) => void;
  error: string | null;
  isLoading: boolean;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin, error, isLoading }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(username, password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 border border-gray-800 rounded-lg shadow-xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold font-sans text-center text-gray-100 mb-6">Aegis Dashboard</h1>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-gray-400 font-sans mb-2" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md py-2 px-3 text-gray-100 focus:outline-none focus:border-blue-400 font-sans"
              autoComplete="username"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-gray-400 font-sans mb-2" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md py-2 px-3 text-gray-100 focus:outline-none focus:border-blue-400 font-sans"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="bg-red-950 border border-red-800 text-red-400 text-center p-2 mb-4 rounded-md font-sans">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:shadow-outline transition-colors disabled:bg-gray-700"
          >
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
