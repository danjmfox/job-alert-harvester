// Preloaded into a CLI subprocess (`node --import`): every clock read answers the instant in FIXED_CLOCK_ISO, so a
// scenario can run the real CLI "on another day" and compare what it prints.
const instant = Date.parse(process.env.FIXED_CLOCK_ISO ?? '');
if (!Number.isNaN(instant)) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(instant);
      else super(...args);
    }

    static now() {
      return instant;
    }
  }
  globalThis.Date = FixedDate;
}
