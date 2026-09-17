// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://tieba.baidu.com/?menu=true" }

import { afterEach, describe, expect, it } from 'vitest';

import { TiebaViewStateObserver } from '../../src/tieba/viewStateObserver';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TiebaViewStateObserver', () => {
  it('notifies once when the feed paints a thread link', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    let changes = 0;
    const observer = new TiebaViewStateObserver(document, () => {
      changes += 1;
    });
    expect(observer.start()).toBe(true);

    const card = document.createElement('div');
    const link = document.createElement('a');
    link.setAttribute('href', '/p/1000000001');
    link.textContent = '帖子';
    card.append(link);
    document.querySelector('#app')?.append(card);
    await flush();

    expect(changes).toBe(1);
    expect(observer.stop()).toBe(true);
  });

  it('notifies when a thread surface hydrates', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    let changes = 0;
    const observer = new TiebaViewStateObserver(document, () => {
      changes += 1;
    });
    observer.start();

    const box = document.createElement('div');
    box.className = 'pc-pb-box';
    const reply = document.createElement('div');
    reply.className = 'pb-comment-item';
    reply.setAttribute('data-id', '111');
    box.append(reply);
    document.querySelector('#app')?.append(box);
    await flush();

    expect(changes).toBe(1);
    observer.stop();
  });

  it('stays silent for mutations without thread links', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    let changes = 0;
    const observer = new TiebaViewStateObserver(document, () => {
      changes += 1;
    });
    observer.start();

    document.querySelector('#app')?.append(document.createElement('span'));
    await flush();

    expect(changes).toBe(0);
    observer.stop();
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
