import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SipProvider } from './contexts/SipContext';
import { applyTheme, watchSystemTheme } from './lib/userPrefs';
import './styles.css';

// Apply theme BEFORE first render so there's no light/dark flash.
applyTheme();
watchSystemTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SipProvider>
        <App />
      </SipProvider>
    </BrowserRouter>
  </React.StrictMode>
);
