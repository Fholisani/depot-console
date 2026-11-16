import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaViewer, type ViewerItem, type ViewerSource } from './media-viewer';

@Component({
  imports: [MediaViewer],
  template: `
    <div class="scroller">
      @if (open()) {
        <app-media-viewer [items]="items" [index]="0" [sourceFor]="source" (close)="closed = closed + 1; open.set(false)" />
      }
    </div>`,
})
class Host {
  readonly open = signal(true);
  closed = 0;
  readonly items: ViewerItem[] = [
    { id: 'a', filename: 'ride.mov', kind: 'video', size: 10 },
    { id: 'b', filename: 'b.jpg', kind: 'image', size: 10 },
  ];
  readonly source = (): Promise<ViewerSource> => Promise.resolve({ kind: 'video', url: 'blob:x' });
}

const touch = (el: Element, type: string, x: number, y: number): void => {
  const e = new Event(type, { bubbles: true }) as Event & { changedTouches: unknown };
  Object.defineProperty(e, 'changedTouches', { value: [{ clientX: x, clientY: y }] });
  el.dispatchEvent(e);
};

describe('MediaViewer', () => {
  afterEach(() => document.querySelectorAll('app-media-viewer').forEach((n) => n.remove()));

  const open = (): { host: Host; fixture: ReturnType<typeof TestBed.createComponent<Host>> } => {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { host: fixture.componentInstance, fixture };
  };

  it('sits on top of the whole page, not inside the scrolling content', () => {
    const { fixture } = open();
    const viewer = document.querySelector('app-media-viewer')!;
    expect(viewer.parentElement).toBe(document.body);
    expect((fixture.nativeElement as HTMLElement).querySelector('.scroller app-media-viewer')).toBeNull();
    expect(viewer.querySelector('button[aria-label="Close viewer"]')).not.toBeNull();
  });

  it('closes with the ✕, a swipe down, or a tap beside the video, and leaves the page', () => {
    const { host, fixture } = open();
    (document.querySelector('button[aria-label="Close viewer"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.closed).toBe(1);
    expect(document.querySelector('app-media-viewer')).toBeNull();

    host.open.set(true);
    fixture.detectChanges();
    const stage = document.querySelector('app-media-viewer .stage')!;
    touch(stage, 'touchstart', 100, 100);
    touch(stage, 'touchend', 110, 300);
    fixture.detectChanges();
    expect(host.closed).toBe(2);

    host.open.set(true);
    fixture.detectChanges();
    (document.querySelector('app-media-viewer .stage') as HTMLElement).click();
    fixture.detectChanges();
    expect(host.closed).toBe(3);
  });

  it('a sideways swipe still moves to the next file instead of closing', () => {
    const { host, fixture } = open();
    const stage = document.querySelector('app-media-viewer .stage')!;
    touch(stage, 'touchstart', 300, 100);
    touch(stage, 'touchend', 100, 120);
    fixture.detectChanges();
    expect(host.closed).toBe(0);
    expect(document.querySelector('app-media-viewer .meta')?.textContent).toContain('2 of 2');
  });
});
