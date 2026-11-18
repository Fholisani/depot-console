import { TestBed } from '@angular/core/testing';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGN_IN_PATIENCE_MS, SignInService } from './sign-in.service';

describe('SignInService', () => {
  let authorizeCalls: number;
  let signIn: SignInService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    authorizeCalls = 0;
    vi.spyOn(window, 'stop').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: OidcSecurityService, useValue: { authorize: () => authorizeCalls++ } }],
    });
    signIn = TestBed.inject(SignInService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('says so when the sign-in page does not come', () => {
    signIn.start();
    expect(authorizeCalls).toBe(1);
    expect(signIn.state().kind).toBe('starting');
    vi.advanceTimersByTime(SIGN_IN_PATIENCE_MS - 1);
    expect(signIn.state().kind).toBe('starting');
    vi.advanceTimersByTime(1);
    expect(signIn.state().kind).toBe('slow');
  });

  it('stays quiet when the browser leaves for the sign-in page in time', () => {
    signIn.start();
    window.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(SIGN_IN_PATIENCE_MS * 2);
    expect(signIn.state().kind).toBe('starting');
  });

  it('try again stops the stuck navigation and starts over', () => {
    signIn.start();
    vi.advanceTimersByTime(SIGN_IN_PATIENCE_MS);
    signIn.tryAgain();
    expect(window.stop).toHaveBeenCalled();
    expect(authorizeCalls).toBe(2);
    expect(signIn.state().kind).toBe('starting');
  });

  it('a second press while starting does not start a second sign-in', () => {
    signIn.start();
    signIn.start();
    expect(authorizeCalls).toBe(1);
  });

  it('a failed callback is shown, not swallowed', () => {
    signIn.fail('token request timed out');
    expect(signIn.state()).toEqual({ kind: 'failed', reason: 'token request timed out' });
    signIn.dismiss();
    expect(signIn.state().kind).toBe('idle');
  });
});
