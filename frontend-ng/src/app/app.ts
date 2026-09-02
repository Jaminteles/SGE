import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Raiz do app: só hospeda o roteador. A moldura vive em `layout/app-layout`. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
