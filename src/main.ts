import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent).catch((error: unknown) => {
  console.error('Flight systems failed to initialize', error);
  document.body.textContent = 'Flight systems failed to initialize. Please reopen the app in an up-to-date webxdc host.';
});
