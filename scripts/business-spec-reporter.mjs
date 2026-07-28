import { writeFileSync } from 'node:fs';
import { tap } from 'node:test/reporters';

export default async function* businessSpecReporter(source) {
  const eventFile = process.env.HHJA_TEST_EVENT_FILE;
  const passedTests = [];

  async function* trackEvents() {
    for await (const event of source) {
      if (event?.type === 'test:pass') {
        passedTests.push({
          name: String(event.data?.name || ''),
          skip: event.data?.skip !== undefined,
          todo: event.data?.todo !== undefined,
          expectFailure: event.data?.expectFailure === true
        });
      }
      yield event;
    }
  }

  try {
    yield* tap(trackEvents());
  } finally {
    if (eventFile) {
      writeFileSync(
        eventFile,
        `${passedTests.map((event) => JSON.stringify(event)).join('\n')}\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
    }
  }
}
