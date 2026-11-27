import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { DepotApi } from '../../core/api/depot-api.service';

/** Only the platform operator opens the operator page; everyone else goes to the dashboard. */
export const operatorGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(DepotApi).me().pipe(
    map((me) => me.operator === true || router.parseUrl('/app/dashboard')),
    catchError(() => of(router.parseUrl('/app/dashboard'))),
  );
};
