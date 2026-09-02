import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { App } from './app';
import { SGE_INTERCEPTORS } from './core/api/interceptors';

describe('App', () => {
  it('monta a raiz com o roteador', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
