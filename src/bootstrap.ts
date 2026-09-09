// Keep the HTML startup message visible if a module download or evaluation fails.
void import('./main').catch(() => window.dispatchEvent(new Event('slop-city-startup-error')));
