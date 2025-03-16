window.addEventListener('error', (event: ErrorEvent) => {
  console.error('Uncaught error:', event.error);
  document.body.innerHTML = `
    <div style="padding: 20px; font-family: sans-serif;">
      <h2>An error occurred while loading the application</h2>
      <pre style="background: #f1f1f1; padding: 10px; border-radius: 5px; overflow: auto;">${event.error?.stack || event.error || 'Unknown error'}</pre>
    </div>
  `;
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.error('Unhandled promise rejection:', event.reason);
  document.body.innerHTML = `
    <div style="padding: 20px; font-family: sans-serif;">
      <h2>An unhandled promise rejection occurred</h2>
      <pre style="background: #f1f1f1; padding: 10px; border-radius: 5px; overflow: auto;">${event.reason?.stack || event.reason || 'Unknown reason'}</pre>
    </div>
  `;
});

console.log('Preload script has loaded successfully');