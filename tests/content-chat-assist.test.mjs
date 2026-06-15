import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readContentScriptSource } from './helpers/content-script-source.mjs';
import { FakeElement } from './helpers/fake-element.mjs';

async function runContentChatAssist({
  chats,
  chatUnreadOnly = true,
  chatReplyMode = 'draft',
  chatLimit = 10,
  groqText = 'Здравствуйте, готов ответить по вакансии.',
  authenticated = true,
  bodyText = 'Чаты'
}) {
  const source = await readContentScriptSource();
  const reports = [];
  const states = [];
  const groqCalls = [];
  let listener = null;
  let activeChatIndex = -1;
  let sendClicks = 0;

  const messageInput = new FakeElement({
    attrs: { 'data-qa': 'chat-message-input' }
  });
  const sendButton = new FakeElement({
    text: 'Отправить',
    click() {
      sendClicks += 1;
    }
  });

  const chatItems = chats.map((chat, index) => new FakeElement({
    text: chat.itemText || [chat.employerName, chat.vacancyTitle, chat.previewText].filter(Boolean).join('\n'),
    href: chat.chatUrl,
    attrs: { class: chat.unread ? 'unread' : '' },
    selectorMap: {
      'a[href*="/vacancy/"]': chat.vacancyUrl ? [new FakeElement({ text: chat.vacancyTitle, href: chat.vacancyUrl })] : [],
      'a[href*="/chat"]': []
    },
    click() {
      activeChatIndex = index;
      globalThis.location.href = chat.chatUrl;
      globalThis.location.pathname = new URL(chat.chatUrl).pathname;
    }
  }));

  globalThis.location = {
    href: 'https://hh.ru/chat',
    pathname: '/chat'
  };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_AUTHENTICATED__: authenticated,
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
      globalThis.location.href = url;
      globalThis.location.pathname = new URL(url).pathname;
    },
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.__HH_JOB_ASSISTANT_TEST_AUTHENTICATED__ = authenticated;
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.Event = class Event {
    constructor(type) {
      this.type = type;
    }
  };

  function currentChat() {
    return chats[Math.max(0, activeChatIndex)] || chats[0];
  }

  globalThis.document = {
    title: 'HH chat test page',
    body: new FakeElement({ text: bodyText }),
    querySelectorAll(selector) {
      if (selector.includes(',')) {
        return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
      }
      if (selector === '[data-qa="chat-list-item"]') return chatItems;
      if (selector === '[data-qa*="chat-item"]') return [];
      if (selector === 'a[href*="/chat"]') return [];
      if (selector === '[role="listitem"]') return [];
      if (selector === '[data-qa="chat-message-input"] textarea') return [messageInput];
      if (selector === '[data-qa="chat-message-input"] [contenteditable="true"]') return [];
      if (selector === 'textarea') return [messageInput];
      if (selector === '[contenteditable="true"]') return [];
      if (selector === '[role="textbox"]') return [];
      if (selector === '[data-qa="chat-send-message"]') return [sendButton];
      if (selector === '[data-qa*="send"]') return [sendButton];
      if (selector === 'button') return [sendButton];
      if (selector === 'main') {
        const chat = currentChat();
        return [new FakeElement({
          text: chat.chatText,
          selectorMap: {
            'a[href*="/vacancy/"]': chat.vacancyUrl ? [new FakeElement({ text: chat.vacancyTitle, href: chat.vacancyUrl })] : []
          }
        })];
      }
      if (selector === 'h1') return [new FakeElement({ text: currentChat().employerName })];
      if (selector === 'a[href*="/vacancy/"]') {
        const chat = currentChat();
        return chat.vacancyUrl ? [new FakeElement({ text: chat.vacancyTitle, href: chat.vacancyUrl })] : [];
      }
      return [];
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    getElementById() {
      return null;
    },
    createElement() {
      return new FakeElement();
    }
  };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      },
      sendMessage(message, callback) {
        const settle = (response) => {
          if (typeof callback === 'function') {
            Promise.resolve(response).then((value) => callback(value));
            return undefined;
          }
          return Promise.resolve(response);
        };
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
          return settle({ ok: true });
        }
        if (message.type === 'APPEND_CHAT_REPORT') {
          reports.push(message.item);
          return settle({ ok: true });
        }
        if (message.type === 'GENERATE_CHAT_REPLY') {
          groqCalls.push(message);
          return settle({ ok: true, text: groqText });
        }
        return settle({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return {
            delayMinMs: 1,
            delayMaxMs: 1,
            chatUnreadOnly,
            chatReplyMode,
            chatLimit
          };
        },
        async set() {}
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#chat-${crypto.randomUUID()}`);
  assert.ok(listener, 'content script should register a listener');

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({ type: 'START_CHAT_ASSIST' }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  return {
    response,
    reports,
    states,
    groqCalls,
    sendClicks,
    inputValue: messageInput.value
  };
}

test('chat assist reports external contact invite with direct chat link and does not send', async () => {
  const result = await runContentChatAssist({
    chats: [
      {
        unread: true,
        chatUrl: 'https://hh.ru/chat/abc',
        employerName: 'ООО Test',
        vacancyTitle: 'Java Developer',
        vacancyUrl: 'https://hh.ru/vacancy/123',
        previewText: 'Новое сообщение',
        chatText: 'ООО Test\nJava Developer\nНапишите мне в Telegram @test_hr'
      }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.processed, 1);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.sendClicks, 0);
  assert.equal(result.groqCalls.length, 0);
  assert.equal(result.reports.at(-1).status, 'reported_external_contact');
  assert.equal(result.reports.at(-1).chatUrl, 'https://hh.ru/chat/abc');
  assert.equal(result.reports.at(-1).contactType, 'telegram');
});

test('chat assist requires hh authorization before reading chats', async () => {
  const result = await runContentChatAssist({
    authenticated: false,
    bodyText: 'Войдите, чтобы читать сообщения',
    chats: [
      {
        unread: true,
        chatUrl: 'https://hh.ru/chat/abc',
        employerName: 'ООО Test',
        vacancyTitle: 'Java Developer',
        previewText: 'Новое сообщение',
        chatText: 'ООО Test\nРасскажите про опыт?'
      }
    ]
  });

  assert.equal(result.response.ok, false);
  assert.match(result.response.error, /Требуется авторизация HH/);
  assert.equal(result.reports.length, 0);
  assert.equal(result.groqCalls.length, 0);
  assert.equal(result.sendClicks, 0);
  assert.equal(result.states.at(-1).state, 'error');
});

test('chat assist skips read chats when unread-only setting is enabled', async () => {
  const result = await runContentChatAssist({
    chats: [
      {
        unread: false,
        chatUrl: 'https://hh.ru/chat/read',
        employerName: 'Read Employer',
        vacancyTitle: 'Java Developer',
        previewText: 'Старое сообщение',
        chatText: 'Read Employer\nРасскажите про опыт?'
      },
      {
        unread: true,
        chatUrl: 'https://hh.ru/chat/unread',
        employerName: 'Unread Employer',
        vacancyTitle: 'Backend Developer',
        previewText: 'Новое сообщение',
        chatText: 'Unread Employer\nКакая зарплата интересна?'
      }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.found, 1);
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].chatUrl, 'https://hh.ru/chat/unread');
  assert.equal(result.groqCalls.length, 1);
});

test('chat assist drafts reply without sending by default', async () => {
  const result = await runContentChatAssist({
    chatReplyMode: 'draft',
    groqText: 'Здравствуйте, ожидаю 250 000 руб. на руки.',
    chats: [
      {
        unread: true,
        chatUrl: 'https://hh.ru/chat/draft',
        employerName: 'ООО Draft',
        vacancyTitle: 'Java Developer',
        vacancyUrl: 'https://hh.ru/vacancy/456',
        previewText: 'Вопрос',
        chatText: 'ООО Draft\nJava Developer\nКакие ожидания по зарплате?'
      }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.sendClicks, 0);
  assert.equal(result.inputValue, 'Здравствуйте, ожидаю 250 000 руб. на руки.');
  assert.equal(result.reports.at(-1).status, 'drafted');
  assert.equal(result.reports.at(-1).sent, false);
  assert.equal(result.groqCalls.at(-1).vacancyUrl, 'https://hh.ru/vacancy/456');
  assert.match(result.groqCalls.at(-1).chatText, /Какие ожидания/);
});

test('chat assist strips markdown from generated drafts', async () => {
  const result = await runContentChatAssist({
    chatReplyMode: 'draft',
    groqText: '**Здравствуйте, ожидаю 250 000 руб. на руки.**',
    chats: [
      {
        unread: true,
        chatUrl: 'https://hh.ru/chat/draft-markdown',
        employerName: 'ООО Draft',
        vacancyTitle: 'Java Developer',
        chatText: 'ООО Draft\nКакие ожидания по зарплате?'
      }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.inputValue, 'Здравствуйте, ожидаю 250 000 руб. на руки.');
  assert.equal(result.reports.at(-1).status, 'drafted');
});

test('chat assist skips generated drafts that look like model garbage', async () => {
  const result = await runContentChatAssist({
    chatReplyMode: 'draft',
    groqText: '{"role":"assistant","content":"ответ"}',
    chats: [
      {
        unread: true,
        chatUrl: 'https://hh.ru/chat/bad-draft',
        employerName: 'ООО Draft',
        vacancyTitle: 'Java Developer',
        chatText: 'ООО Draft\nКакие ожидания по зарплате?'
      }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.inputValue, '');
  assert.equal(result.reports.at(-1).status, 'skipped_bad_generated_reply');
});

test('chat assist auto-send mode clicks send button', async () => {
  const result = await runContentChatAssist({
    chatReplyMode: 'auto_send',
    chats: [
      {
        unread: true,
        chatUrl: 'https://hh.ru/chat/send',
        employerName: 'ООО Send',
        vacancyTitle: 'Java Developer',
        previewText: 'Вопрос',
        chatText: 'ООО Send\nКогда готовы начать?'
      }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.sendClicks, 1);
  assert.equal(result.reports.at(-1).status, 'sent');
  assert.equal(result.reports.at(-1).sent, true);
});
