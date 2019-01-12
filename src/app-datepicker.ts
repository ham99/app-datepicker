import {
  css,
  customElement,
  html,
  LitElement,
  property,
  query,
} from 'lit-element';

import { cache } from 'lit-html/directives/cache.js';
import { classMap } from 'lit-html/directives/class-map.js';

import { iconChevronLeft, iconChevronRight } from './app-datepicker-icons.js';
import { calendarDays, calendarWeekdays } from './calendar.js';
import { datepickerVariables, resetButton } from './common-styles.js';
import {
  computeNewFocusedDateWithKeyboard,
  computeThreeCalendarsInARow,
  dispatchCustomEvent,
  findShadowTarget,
  getResolvedLocale,
  getResolvedTodayDate,
  KEYCODES_MAP,
  toFormattedDateString,
} from './datepicker-helpers.js';
import { Tracker } from './tracker.js';

function renderHeaderSelectorButton({
  locale,
  selectedDate,
  focusedDate,
  selectedView,

  updateViewFn,
}) {
  const formattedDate = Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(focusedDate);
  const isCalendarView = selectedView === 'calendar';

  return html`
  <button
    class="${classMap({ 'btn__selector-year': true, selected: !isCalendarView })}"
    view="year"
    @click="${() => updateViewFn('year')}">${new Date(selectedDate).getUTCFullYear()}</button>

  <div class="datepicker-toolbar">
    <button
      class="${classMap({ 'btn__selector-calendar': true, selected: isCalendarView })}"
      view="calendar"
      @click="${() => updateViewFn('calendar')}">${formattedDate}</button>
  </div>
  `;
}

function renderDatepickerYearList({
  updateYearFn,

  yearList,
  selectedDate,
}) {
  return html`
  <div class="datepicker-body__year-view">
    <div class="year-view__full-list" @click="${ev => updateYearFn(ev)}">
    ${(yearList.map(n =>
      html`<button
        class="${classMap({
          'year-view__list-item': true,
          'year--selected': selectedDate.getUTCFullYear() === n,
        })}"
        .year="${n}">
        <div>${n}</div>
      </button>`))}
    </div>
  </div>
  `;
}

function renderDatepickerCalendar({
  disabledDays,
  firstDayOfWeek,
  focusedDate,
  locale,
  max,
  min,
  selectedDate,
  showWeekNumber,
  todayDate,
  weekNumberType,

  updateFocusedDateFn,
  updateMonthFn,
  updateMonthWithKeyboardFn,
}) {
  const dayFormatterFn = Intl.DateTimeFormat(locale, { day: 'numeric' }).format;
  const fullDateFormatterFn = Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format;
  const longWeekdayFormatterFn = Intl.DateTimeFormat(locale, { weekday: 'long' }).format;
  const narrowWeekdayFormatterFn = Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format;
  const longMonthYearFormatterFn = Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
  }).format;

  let clt = window.performance.now();
  const minTime = +new Date(min);
  const maxTime = +new Date(max);
  const weekdays = calendarWeekdays({
    firstDayOfWeek,
    showWeekNumber,

    longWeekdayFormatter: longWeekdayFormatterFn,
    narrowWeekdayFormatter: narrowWeekdayFormatterFn,
  });
  const calendars = computeThreeCalendarsInARow(selectedDate).map((n, idx) => {
    const nFy = n.getUTCFullYear();
    const nM = n.getUTCMonth();
    const firstDayOfMonthTime = +new Date(Date.UTC(nFy, nM, 1));
    const lastDayOfMonthTime = +new Date(Date.UTC(nFy, nM + 1, 0));

    /**
     * NOTE: Return `null` when one of the followings fulfills:-
     *
     *           minTime            maxTime
     *       |--------|--------o--------|--------|
     *   last day     |   valid dates   |     first day
     *
     *  - last day of the month < `minTime` - entire month should be disabled
     *  - first day of the month > `maxTime` - entire month should be disabled
     */
    if (lastDayOfMonthTime < minTime || firstDayOfMonthTime > maxTime) {
      return null;
    }

    return calendarDays({
      firstDayOfWeek,
      showWeekNumber,
      weekNumberType,
      selectedDate: n,
      idOffset: idx * 10,

      dayFormatter: dayFormatterFn,
      fullDateFormatter: fullDateFormatterFn,
    });
  });
  clt = window.performance.now() - clt;
  const cltEl = document.body.querySelector('.calendar-render-time');
  if (cltEl) (cltEl.textContent = `Rendering calendar takes ${clt.toFixed(3)} ms`);

  let hasMinDate = false;
  let hasMaxDate = false;

  const fixedDisabledDays = Array.isArray(disabledDays) && disabledDays.length > 0
    ? disabledDays.map(n => showWeekNumber ? n + 1 : n)
    : [];
  const weekdaysContent = weekdays.map((o: any) => {
    return html`<th aria-label="${o.label}">${o.value}</th>`;
  });
  const calendarsContent = calendars.map((daysInMonth, i) => {
    if (daysInMonth == null) {
      /** NOTE: If first and last month is of type null, set the corresponding flag. */
      if (i === 0) hasMinDate = true;
      if (i === 2) hasMaxDate = true;

      return html`<div class="calendar-container"></div>`;
    }

    let formattedDate: string | null = null;

    const tbodyContent = daysInMonth.map((n) => {
      const trContent = n.map((o: any, oi) => {
        if (o.fullDate == null && o.value == null) {
          return html`<td class="full-calendar__day day--empty"></td>`;
        }

        /** NOTE(motss): Could be week number labeling */
        if (o.fullDate == null && showWeekNumber && oi < 1) {
          return html`
          <td class="full-calendar__day weekday-label" aria-label="${o.label}">${o.value}</td>
          `;
        }

        const curTime = +new Date(o.fullDate);
        if (formattedDate == null) formattedDate = longMonthYearFormatterFn(curTime);

        const isDisabledDay = fixedDisabledDays.some(fdd => fdd === oi)
          || (curTime < minTime || curTime > maxTime);

        return html`
        <td
          class="${classMap({
            'full-calendar__day': true,
            'day--disabled': isDisabledDay,
            'day--today': +todayDate === curTime,
            'day--focused': +focusedDate === curTime,
          })}"
          aria-label="${o.label}"
          .full-date="${o.fullDate}"
          .day="${o.value}">
          <div class="calendar-day">${o.value}</div>
        </td>
        `;
      });

      return html`<tr>${trContent}</tr>`;
    });

    return html`
    <div class="calendar-container">
      <div class="calendar-label">${formattedDate}</div>

      <table class="calendar-table" @click="${ev => updateFocusedDateFn(ev)}">
        <thead>
          <tr class="calendar-weekdays">${weekdaysContent}</tr>
        </thead>

        <tbody>${tbodyContent}</tbody>
      </table>
    </div>
    `;
  });

  return html`
  <div class="datepicker-body__calendar-view">
    <div class="calendar-view__month-selector">
      <div class="month-selector-container">
        ${hasMinDate
          ? null
          : html`
            <button
              class="month-selector-button"
              aria-label="Previous month"
              @click="${() => updateMonthFn('previous')}">${iconChevronLeft}</button>
          `}
      </div>

      <div class="month-selector-container">
        ${hasMaxDate
          ? null
          : html`
            <button
              class="month-selector-button"
              aria-label="Next month"
              @click="${() => updateMonthFn('next')}">${iconChevronRight}</button>
          `}
      </div>
    </div>

    <div
      class="${classMap({
        'calendar-view__full-calendar': true,
        'has-min-date': hasMinDate,
        'has-max-date': hasMaxDate,
      })}"
      tabindex="0"
      @keyup="${ev => updateMonthWithKeyboardFn(ev)}">${calendarsContent}</div>
  </div>
  `;
}

@customElement(AppDatepicker.is)
export class AppDatepicker extends LitElement {
  static get is() {
    return 'app-datepicker';
  }

  @property({ type: String })
  public min: string;

  @property({ type: String })
  public max: string = '2100-12-31';

  @property({ type: Number })
  public firstDayOfWeek: number = 0;

  @property({ type: Boolean })
  public showWeekNumber: boolean = false;

  @property({ type: String })
  public weekNumberType: string = 'first-4-day-week';

  @property({ type: String })
  public disabledDays: string = '0,6';

  @property({ type: String })
  public disableDates: string;

  @property({ type: String })
  public format: string = 'yyyy-MM-dd';

  @property({ type: Boolean })
  public landscape: boolean = false;

  @property({ type: String })
  public locale: string = getResolvedLocale();

  @property({ type: Number })
  public dragRatio: number = .15;

  // @property({ type: String })
  // // @ts-ignore
  // public startView: string = 'calendar';

  // @property({ type: String })
  // // @ts-ignore
  // public value: string;

  @property({ type: String })
  private _startView: string = 'calendar';

  @property({ type: String })
  private _selectedView: string = 'calendar';

  @property({ type: Date })
  private _selectedDate: Date;

  @property({ type: Date })
  private _focusedDate: Date;

  @query('.year-view__full-list')
  private _yearViewFullList: HTMLDivElement;

  @query('.datepicker-body__calendar-view')
  private _datepickerBodyCalendarView: HTMLDivElement;

  @query('.calendar-view__full-calendar')
  private _calendarViewFullCalendar: HTMLDivElement;

  @query('.btn__selector-year')
  private _buttonSelectorYear: HTMLButtonElement;

  @query('.year-view__list-item')
  private _yearViewListItem: HTMLButtonElement;

  private _todayDate: Date;
  private _totalDraggableDistance: number;
  private _dragAnimationDuration: number = 150;
  private _yearList: number[];
  private _hasCalendarSetup: boolean = false;
  private _hasNativeElementAnimate: boolean =
    Element.prototype.animate.toString().indexOf('[native code]') >= 0;

  // weekdayFormat: String,

  public constructor() {
    super();

    this._updateMonthFn = this._updateMonthFn.bind(this);
    this._updateViewFn = this._updateViewFn.bind(this);
    this._updateYearFn = this._updateYearFn.bind(this);
    this._updateFocusedDateFn = this._updateFocusedDateFn.bind(this);
    this._trackingStartFn = this._trackingStartFn.bind(this);
    this._trackingMoveFn = this._trackingMoveFn.bind(this);
    this._trackingEndFn = this._trackingEndFn.bind(this);
    this._updateMonthWithKeyboardFn = this._updateMonthWithKeyboardFn.bind(this);

    const todayDate = getResolvedTodayDate();
    const todayDateFullYear = todayDate.getUTCFullYear();
    const yearList: number[] = [];
    for (let i = 0, len = 2100 - todayDateFullYear + 1; i < len; i += 1) {
      yearList.push(todayDateFullYear + i);
    }

    this.min = todayDate.toJSON();
    this._yearList = yearList;
    this._todayDate = todayDate;
    this._selectedDate = todayDate;
    this._focusedDate = todayDate;
    this.value = toFormattedDateString(todayDate);
  }

  static get styles() {
    // tslint:disable:max-line-length
    return [
      datepickerVariables,
      resetButton,
      css`
      :host {
        display: block;
        width: var(--app-datepicker-width);
        /** NOTE: Magic number as 16:9 aspect ratio does not look good */
        /* height: calc((var(--app-datepicker-width) / .66) - var(--app-datepicker-footer-height, 56px)); */
        background-color: #fff;
        border-top-left-radius: var(--app-datepicker-border-top-left-radius, var(--app-datepicker-border-radius));
        border-top-right-radius: var(--app-datepicker-border-top-right-radius, var(--app-datepicker-border-radius));
        border-bottom-left-radius: var(--app-datepicker-border-bottom-left-radius, var(--app-datepicker-border-radius));
        border-bottom-right-radius: var(--app-datepicker-border-bottom-right-radius, var(--app-datepicker-border-radius));
        overflow: hidden;
      }
      :host([landscape]) {
        display: flex;
        flex-direction: row;

        /** <iphone-5-landscape-width> - <standard-side-margin-width> */
        --app-datepicker-width: calc(568px - 16px * 2);
      }

      * {
        box-sizing: border-box;
      }

      .datepicker-header + .datepicker-body {
        border-top: 1px solid #ddd;
      }
      :host([landscape]) > .datepicker-header + .datepicker-body {
        border-top: none;
        border-left: 1px solid #ddd;
      }

      .datepicker-header {
        display: flex;
        flex-direction: column;
        align-items: flex-start;

        position: relative;
        padding: 16px 24px;
      }
      :host([landscape]) > .datepicker-header {
        /** :this.<one-liner-month-day-width> + :this.<side-padding-width> */
        min-width: calc(14ch + 24px * 2);
      }

      .btn__selector-year,
      .btn__selector-calendar {
        color: rgba(0, 0, 0, .55);
        cursor: pointer;
        /* outline: none; */
      }
      .btn__selector-year.selected,
      .btn__selector-calendar.selected {
        color: currentColor;
      }

      .btn__selector-year {
        font-size: 16px;
        font-weight: 700;
      }
      .btn__selector-calendar {
        font-size: 36px;
        font-weight: 700;
        line-height: 1;
      }

      .datepicker-body {
        position: relative;
        width: 100%;
        overflow: hidden;
      }

      .datepicker-body__calendar-view {
        min-height: 56px;
      }

      .calendar-view__month-selector {
        display: flex;
        flex-direction: row;
        align-items: center;

        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        padding: 0 8px;
        z-index: 1;
      }

      .month-selector-container {
        max-height: 56px;
        height: 100%;
      }
      .month-selector-container + .month-selector-container {
        margin: 0 0 0 auto;
      }
      /* .month-selector-container > paper-icon-button-light {
        max-width: 56px;
        max-height: 56px;
        height: 56px;
        width: 56px;
        color: rgba(0, 0, 0, .25);
      } */

      .month-selector-button {
        padding: calc((56px - 24px) / 2);
        /**
         * NOTE: button element contains no text, only SVG.
         * No extra height will incur with such setting.
         */
        line-height: 0;
      }
      .month-selector-button:hover {
        cursor: pointer;
      }

      .calendar-view__full-calendar {
        display: flex;
        flex-direction: row;
        justify-content: center;

        position: relative;
        width: calc(100% * 3);
        padding: 0 0 16px;
        will-change: transform;
        /**
         * NOTE: Required for Pointer Events API to work on touch devices.
         * Native \`pan-y\` action will be fired by the browsers since we only care about the
         * horizontal direction. This is great as vertical scrolling still works even when touch
         * event happens on a datepicker's calendar.
         */
        touch-action: pan-y;
        /* outline: none; */
      }

      .year-view__full-list {
        max-height: calc(48px * 7);
        overflow-y: auto;
      }

      .calendar-weekdays > th,
      td.weekday-label {
        color: rgba(0, 0, 0, .55);
        font-weight: 400;
      }

      .calendar-container {
        max-width: calc(100% / 3);
        width: calc(100% / 3);
      }

      .calendar-label,
      .calendar-table {
        width: calc(100% - 16px * 2);
      }

      .calendar-label {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;

        max-width: calc(100% - 8px * 2);
        width: 100%;
        height: 56px;
        margin: 0 8px;
        font-weight: 500;
        text-align: center;
      }

      .calendar-table {
        -moz-user-select: none;
        -webkit-user-select: none;
        user-select: none;

        margin: 0 16px;
        border-collapse: collapse;
        text-align: center;
      }

      tr > th,
      tr > td {
        position: relative;
        min-height: 40px;
        height: 40px;
        padding: 8px 0;
      }

      /**
       * NOTE: Interesting fact! That is ::after will trigger paint when dragging. This will trigger
       * layout and paint on **ONLY** affected nodes. This is much cheaper as compared to rendering
       * all :::after of all calendar day elements. When dragging the entire calendar container,
       * because of all layout and paint trigger on each and every ::after, this becomes a expensive
       * task for the browsers especially on low-end devices. Even though animating opacity is much
       * cheaper, the technique does not work here. Adding 'will-change' will further reduce overall
       * painting at the expense of memory consumption as many cells in a table has been promoted
       * a its own layer.
       */
      tr > td.full-calendar__day:not(.day--empty):not(.day--disabled):not(.weekday-label) {
        will-change: transform;
      }
      tr > td.full-calendar__day:not(.day--empty):not(.day--disabled):not(.weekday-label).day--focused::after,
      tr > td.full-calendar__day:not(.day--empty):not(.day--disabled):not(.day--focused):not(.weekday-label):hover::after {
        content: '';
        display: block;
        position: absolute;
        width: 40px;
        height: 40px;
        top: 50%;
        left: 50%;
        background-color: var(--app-datepicker-primary-color);
        border-radius: 50%;
        transform: translate3d(-50%, -50%, 0);
        will-change: transform;
        opacity: 0;
        pointer-events: none;
      }
      tr > td.full-calendar__day:not(.day--empty):not(.day--disabled):not(.weekday-label).day--focused::after {
        opacity: 1;
      }
      tr > td.full-calendar__day:not(.day--empty):not(.day--disabled):not(.day--focused):not(.weekday-label):hover::after {
        opacity: .15;
      }
      tr > td.full-calendar__day:not(.day--empty):not(.day--disabled):not(.weekday-label) {
        cursor: pointer;
        pointer-events: auto;
        -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
      }
      tr > td.full-calendar__day.day--focused:not(.day--empty):not(.day--disabled):not(.weekday-label)::after,
      tr > td.full-calendar__day.day--today.day--focused:not(.day--empty):not(.day--disabled):not(.weekday-label)::after {
        opacity: 1;
      }

      tr > td.full-calendar__day > .calendar-day {
        position: relative;
        color: #000;
        z-index: 1;
        pointer-events: none;
      }
      tr > td.full-calendar__day.day--today > .calendar-day {
        color: var(--app-datepicker-primary-color);
      }
      tr > td.full-calendar__day.day--focused > .calendar-day,
      tr > td.full-calendar__day.day--today.day--focused > .calendar-day {
        color: #fff;
      }
      tr > td.full-calendar__day.day--empty,
      tr > td.full-calendar__day.weekday-label,
      tr > td.full-calendar__day.day--disabled > .calendar-day {
        pointer-events: none;
      }
      tr > td.full-calendar__day.day--disabled > .calendar-day {
        color: rgba(0, 0, 0, .35);
      }

      .year-view__list-item {
        position: relative;
        width: 100%;
        padding: 12px 16px;
        text-align: center;
        /** NOTE: Reduce paint when hovering and scrolling, but this increases memory usage */
        /* will-change: opacity; */
        /* outline: none; */
      }
      .year-view__list-item:hover {
        cursor: pointer;
      }
      .year-view__list-item > div {
        z-index: 1;
      }
      .year-view__list-item::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: #000;
        opacity: 0;
        pointer-events: none;
      }
      .year-view__list-item:focus::after,
      .year-view__list-item:hover::after {
        opacity: .05;
      }
      .year-view__list-item.year--selected {
        color: var(--app-datepicker-primary-color);
        font-size: 24px;
        font-weight: 500;
      }
      `,
    ];
    // tslint:enable:max-line-length
  }

  protected render() {
    const locale = this.locale;
    const disabledDays = this.disabledDays;
    const firstDayOfWeek = this.firstDayOfWeek;
    const min = this.min;
    const max = this.max;
    const showWeekNumber = this.showWeekNumber;
    const weekNumberType = this.weekNumberType;
    const yearList = this._yearList;

    const focusedDate = new Date(this._focusedDate);
    const selectedDate = new Date(this._selectedDate);
    const selectedView = this._selectedView;
    const todayDate = getResolvedTodayDate();

    /** NOTE(motss): For perf reason, initialize all formatters for calendar rendering */
    const datepickerBodyContent = selectedView === 'calendar'
      ? renderDatepickerCalendar({
        disabledDays,
        firstDayOfWeek,
        focusedDate,
        locale,
        max,
        min,
        selectedDate,
        showWeekNumber,
        todayDate,
        weekNumberType,
        updateFocusedDateFn: this._updateFocusedDateFn,
        updateMonthFn: this._updateMonthFn,
        updateMonthWithKeyboardFn: this._updateMonthWithKeyboardFn,
      })
      : renderDatepickerYearList({
        selectedDate,
        yearList,

        updateYearFn: this._updateYearFn,
      });

    // tslint:disable:max-line-length
    return html`
    <div class="datepicker-header">
    ${(renderHeaderSelectorButton({
      locale,
      selectedDate,
      focusedDate,
      selectedView,
      updateViewFn: this._updateViewFn,
    }))}
    </div>

    <div class="datepicker-body">
    ${cache(datepickerBodyContent)}
    </div>
    `;
    // tslint:enable:max-line-length
  }

  protected firstUpdated() {
    const firstFocusableElement = this._selectedView === 'calendar'
      ? this._buttonSelectorYear
      : this._yearViewListItem;

    dispatchCustomEvent(this, 'datepicker-first-updated', { firstFocusableElement });
  }

  protected updated() {
    const selectedView = this._selectedView;

    if (selectedView === 'year') {
      this.updateComplete
        .then(() => {
          return this._yearViewFullList.scrollTo({
            top: (this._selectedDate.getUTCFullYear() - this._todayDate.getUTCFullYear() - 2) * 48,
            left: 0,
          });
        });
    }

    if (selectedView === 'calendar' && !this._hasCalendarSetup) {
      const dragEl = this._calendarViewFullCalendar;
      const totalDraggableDistance = this._datepickerBodyCalendarView.getBoundingClientRect().width;
      let started = false;
      let dx = 0;
      let abortDragIfHasMinDate = false;
      let abortDragIfHasMaxDate = false;

      const handlers = {
        down: () => {
          if (started) return;
          this._trackingStartFn();
          started = true;
        },
        move: (changedPointer, oldPointer) => {
          if (!started) return;
          dx += changedPointer.x - oldPointer.x;
          abortDragIfHasMinDate = dx > 0 && dragEl.classList.contains('has-min-date');
          abortDragIfHasMaxDate = dx < 0 && dragEl.classList.contains('has-max-date');

          if (abortDragIfHasMaxDate || abortDragIfHasMinDate) return;

          this._trackingMoveFn(dx);
        },
        up: (changedPointer, oldPointer) => {
          if (!started) return;
          if (abortDragIfHasMaxDate || abortDragIfHasMinDate) {
            abortDragIfHasMaxDate = false;
            abortDragIfHasMinDate = false;
            dx = 0;
            return;
          }

          dx += changedPointer.x - oldPointer.x;
          this._trackingEndFn(dx);
          dx = 0;
          started = false;
        },
      };
      // tslint:disable-next-line:no-unused-expression
      new Tracker(dragEl, handlers);

      dragEl.style.transform = `translate3d(${totalDraggableDistance * -1}px, 0, 0)`;
      this._totalDraggableDistance = totalDraggableDistance;
      this._hasCalendarSetup = true;
    }
  }

  private _updateViewFn(view: string) {
    this._selectedView = view;
  }

  private _updateMonthFn(updateType: string) {
    const calendarViewFullCalendar = this._calendarViewFullCalendar;
    const totalDraggableDistance = this._totalDraggableDistance;
    const dateDate = this._selectedDate;
    const fy = dateDate.getUTCFullYear();
    const m = dateDate.getUTCMonth();
    /** NOTE: updateType === 'next' as fallback */
    const isPreviousMonth = updateType === 'previous';
    const initialX = totalDraggableDistance * -1;
    const newDx = totalDraggableDistance * (isPreviousMonth ? 0 : -2);

    const dragAnimation = calendarViewFullCalendar.animate([
      { transform: `translate3d(${initialX}px, 0, 0)` },
      { transform: `translate3d(${newDx}px, 0, 0)` },
    ], {
      duration: this._dragAnimationDuration,
      easing: 'cubic-bezier(0, 0, .4, 1)',
      fill: this._hasNativeElementAnimate ? 'none' : 'both',
    });

    return new Promise(yay => (dragAnimation.onfinish = yay))
      .then(() => new Promise(yay => window.requestAnimationFrame(yay)))
      .then(() => {
        const newM = m + (isPreviousMonth ? -1 : 1);
        this._selectedDate = new Date(Date.UTC(fy, newM, 1));

        return this.updateComplete;
      })
      .then(() => {
        calendarViewFullCalendar.style.transform = `translate3d(${initialX}px, 0, 0)`;
      });
  }

  private _updateYearFn(ev: CustomEvent) {
    const selectedYearEl = findShadowTarget(ev, n => n.classList.contains('year-view__list-item'));

    if (selectedYearEl == null) return;

    const dateDate = this._selectedDate;
    const m = dateDate.getUTCMonth();
    const d = dateDate.getUTCDate();
    const selectedYear = Number((selectedYearEl as HTMLButtonElement)!.textContent);

    /**
     * 2 things to do here:
     *  - Update `_selectedDate` with selected year
     *  - Update `_selectedView` to 'calendar'
     */
    this._selectedDate = new Date(Date.UTC(selectedYear, m, d));
    this._selectedView = 'calendar';
  }

  private _updateFocusedDateFn(ev: CustomEvent) {
    const selectedDayEl = findShadowTarget(ev, n => n.classList.contains('full-calendar__day'));

    /** NOTE: Required condition check else these will trigger unwanted re-rendering */
    if (selectedDayEl == null
      || (selectedDayEl as HTMLTableDataCellElement).classList.contains('day--empty')
      || (selectedDayEl as HTMLTableDataCellElement).classList.contains('day--disabled')
      || (selectedDayEl as HTMLTableDataCellElement).classList.contains('day--focused')
      || (selectedDayEl as HTMLTableDataCellElement).classList.contains('weekday-label')) return;

    const dateDate = new Date(this._selectedDate);
    const fy = dateDate.getUTCFullYear();
    const m = dateDate.getUTCMonth();
    const selectedDate = Number((selectedDayEl as HTMLTableDataCellElement).textContent);

    this._focusedDate = new Date(Date.UTC(fy, m, selectedDate));
  }

  private _trackingStartFn() {
    const trackableEl = this._calendarViewFullCalendar;
    const trackableElWidth = trackableEl.getBoundingClientRect().width;
    const totalDraggableDistance = trackableElWidth / 3;

    /**
     * NOTE(motss): Perf tips - By setting fixed width for the following containers,
     * it drastically minimizes layout and painting during tracking even on slow
     * devices:-
     *
     *  - `.calendar-view__full-calender`
     *  - `.datepicker-body__calendar-view`
     */
    trackableEl.style.width = `${trackableElWidth}px`;
    trackableEl.style.minWidth = `${trackableElWidth}px`;
    this._totalDraggableDistance = totalDraggableDistance;
  }
  private _trackingMoveFn(dx: number) {
    const totalDraggableDistance = this._totalDraggableDistance;
    const clamped = Math.min(totalDraggableDistance, Math.abs(dx));
    const isPositive = dx > 0;
    const newX = totalDraggableDistance * -1 + (clamped * (isPositive ? 1 : -1));
    this._calendarViewFullCalendar.style.transform = `translate3d(${newX}px, 0, 0)`;
  }
  private _trackingEndFn(dx: number) {
    const calendarViewFullCalendar = this._calendarViewFullCalendar;
    const totalDraggableDistance = this._totalDraggableDistance;
    const isPositive = dx > 0;
    const absDx = Math.abs(dx);
    const clamped = Math.min(totalDraggableDistance, absDx);
    const initialX = totalDraggableDistance * -1;
    const newX = totalDraggableDistance * -1 + (clamped * (isPositive ? 1 : -1));

    /**
     * NOTE(motss):
     * If dragged distance < `dragRatio`, reset calendar position.
     */
    if (absDx < totalDraggableDistance * this.dragRatio) {
      const restoreDragAnimation = calendarViewFullCalendar.animate([
        { transform: `translate3d(${newX}px, 0, 0)` },
        { transform: `translate3d(${initialX}px, 0, 0)` },
      ], {
        duration: this._dragAnimationDuration,
        easing: 'cubic-bezier(0, 0, .4, 1)',
        fill: this._hasNativeElementAnimate ? 'none' : 'both',
      });

      return new Promise(yay => (restoreDragAnimation.onfinish = yay))
        .then(() => new Promise(yay => window.requestAnimationFrame(yay)))
        .then(() => {
          calendarViewFullCalendar.style.transform = `translate3d(${initialX}px, 0, 0)`;
          return this.updateComplete;
        });
    }

    const restDx = totalDraggableDistance * (isPositive ? 0 : -2);
    const dragAnimation = calendarViewFullCalendar.animate([
      { transform: `translate3d(${newX}px, 0, 0)` },
      { transform: `translate3d(${restDx}px, 0, 0)` },
    ], {
      duration: this._dragAnimationDuration,
      easing: 'cubic-bezier(0, 0, .4, 1)',
      fill: this._hasNativeElementAnimate ? 'none' : 'both',
    });

    /** NOTE(motss): Drag to next calendar when drag ratio meets threshold value */
    return new Promise(yay => (dragAnimation.onfinish = yay))
      .then(() => new Promise(yay => window.requestAnimationFrame(yay)))
      .then(() => {
        const dateDate = new Date(this._selectedDate);
        const fy = dateDate.getUTCFullYear();
        const m = dateDate.getUTCMonth();
        const d = dateDate.getUTCDate();
        const nm = isPositive ? -1 : 1;

        this._selectedDate = new Date(Date.UTC(fy, m + nm, d));

        return this.updateComplete;
      })
      .then(() => {
        calendarViewFullCalendar.style.transform = `translate3d(${initialX}px, 0, 0)`;
        return this.updateComplete;
      });
  }

  // Left Move focus to the previous day. Will move to the last day of the previous month,
  //  if the current day is the first day of a month.
  // Right Move focus to the next day. Will move to the first day of the following month,
  //  if the current day is the last day of a month.
  // Up Move focus to the same day of the previous week.
  //  Will wrap to the appropriate day in the previous month.
  // Down Move focus to the same day of the following week.
  //  Will wrap to the appropriate day in the following month.
  // PgUp Move focus to the same date of the previous month. If that date does not exist,
  //  focus is placed on the last day of the month.
  // PgDn Move focus to the same date of the following month. If that date does not exist,
  //  focus is placed on the last day of the month.
  // Alt+PgUp Move focus to the same date of the previous year.
  //  If that date does not exist (e.g leap year), focus is placed on the last day of the month.
  // Alt+PgDn Move focus to the same date of the following year.
  //  If that date does not exist (e.g leap year), focus is placed on the last day of the month.
  // Home Move to the first day of the month.
  // End Move to the last day of the month
  // Tab / Shift+Tab If the datepicker is in modal mode, navigate between calender grid and
  //  close/previous/next selection buttons, otherwise move to the field following/preceding the
  //  date textbox associated with the datepicker
  // Enter / Space Fill the date textbox with the selected date then close the datepicker widget.
  private _updateMonthWithKeyboardFn(ev: KeyboardEvent) {
    const keyCode = ev.keyCode;

    /** NOTE: Skip for TAB key and other non-related keys */
    if (keyCode === KEYCODES_MAP.TAB
      || (keyCode !== KEYCODES_MAP.ARROW_DOWN
      && keyCode !== KEYCODES_MAP.ARROW_LEFT
      && keyCode !== KEYCODES_MAP.ARROW_RIGHT
      && keyCode !== KEYCODES_MAP.ARROW_UP
      && keyCode !== KEYCODES_MAP.END
      && keyCode !== KEYCODES_MAP.HOME
      && keyCode !== KEYCODES_MAP.PAGE_DOWN
      && keyCode !== KEYCODES_MAP.PAGE_UP
      && keyCode !== KEYCODES_MAP.ENTER
      && keyCode !== KEYCODES_MAP.SPACE)) return;

    const hasAltKey = ev.altKey;
    const min = new Date(this.min);
    const max = new Date(this.max);
    const selectedDate = this._selectedDate;
    const focusedDate = this._focusedDate;
    const fdFy = focusedDate.getUTCFullYear();
    const fdM = focusedDate.getUTCMonth();
    const fdD = focusedDate.getUTCDate();

    let fy = fdFy;
    let m = fdM;
    let d = fdD;
    let isMonthYearUpdate = false;

    /**
     * NOTE: Focus to the 1st day of the current month when:-
     *
     *  - `_selectedDate` has a different value of _full year_ than that of `_focusedDate`.
     *  - `_selectedDate` has a different value of _month_ than that of `_focusedDate`.
     *
     * This could simply mean that user changes `_selectedDate` with a new value of `month` or
     * `year` but `_focusedDate` remains unchanged and it could be an out-of-bound calendar date.
     * When keyboard event is detected, the 1st day of the current visible/ focusing month should be
     * focused by updating `_focusedDate` with that value.
     */
    if (selectedDate.getUTCMonth() !== fdM || selectedDate.getUTCFullYear() !== fdFy) {
      this._focusedDate = new Date(Date.UTC(
        selectedDate.getUTCFullYear(),
        selectedDate.getUTCMonth(),
        1));

      return this.updateComplete;
    }

    switch (keyCode) {
      case KEYCODES_MAP.ARROW_UP: {
        d -= 7;
        break;
      }
      case KEYCODES_MAP.ARROW_RIGHT: {
        d += 1;
        break;
      }
      case KEYCODES_MAP.ARROW_DOWN: {
        d += 7;
        break;
      }
      case KEYCODES_MAP.ARROW_LEFT: {
        d -= 1;
        break;
      }
      case KEYCODES_MAP.HOME: {
        d = 1;
        break;
      }
      case KEYCODES_MAP.END: {
        m += 1;
        d = 0;
        break;
      }
      case KEYCODES_MAP.ENTER: {
        if (+selectedDate !== +focusedDate) {
          this._selectedDate = focusedDate;
        }

        return this.updateComplete;
      }
      case KEYCODES_MAP.PAGE_UP: {
        isMonthYearUpdate = true;
        hasAltKey ? fy -= 1 : m -= 1;
        break;
      }
      case KEYCODES_MAP.PAGE_DOWN: {
        isMonthYearUpdate = true;
        hasAltKey ? fy += 1 : m += 1;
        break;
      }
    }

    /** NOTE: Skip calendar update if new focused date remains unchanged. */
    if (fy === fdFy && m === fdM && d === fdD) return;

    const { shouldUpdateDate, date } = computeNewFocusedDateWithKeyboard({
      min,
      max,
      selectedDate,
      fy,
      m,
      d,
      isMonthYearUpdate,
    });

    /**
     * NOTE: If `date` returns null or `date` still same as `focusedDate`,
     * this can skip updating any dates. This could simply mean the new focused date is
     * within the range of * `min` and `max` dates.
     */
    if (date == null || +date === +focusedDate) return;

    /**
     * NOTE: Update `_selectedDate` if new focused date is no longer in the same month or year.
     */
    if (shouldUpdateDate) this._selectedDate = date;

    this._focusedDate = date;

    return this.updateComplete;
  }

  // @ts-ignore
  public get startView() {
    return this._startView;
  }
  // @ts-ignore
  public set startView(val: string) {
    if (val !== 'calendar' && val !== 'year') return;

    this._startView = val;
    this._selectedView = val;
  }

  // @ts-ignore
  public get value() {
    return toFormattedDateString(this._focusedDate);
  }
  // @ts-ignore
  public set value(val: string) {
    const minDate = new Date(this.min);
    const maxDate = new Date(this.max);
    const valDate = new Date(val);

    /** NOTE: Skip updating to new date if date input is invalid */
    if (val == null || valDate.toJSON() == null) return;

    const fy = valDate.getUTCFullYear();
    const m = valDate.getUTCMonth();
    const d = valDate.getUTCDate();
    const newDate = new Date(Date.UTC(fy, m, d));

    if (+newDate < +minDate || +newDate > +maxDate) return;

    this._focusedDate = newDate;
    this._selectedDate = newDate;
    // this.valueAsDate = newDate;
    // this.valueAsNumber = +newDate;
  }

}

// TODO: To look into `passive` event listener option in future.
// TODO: To suppport `valueAsDate` and `valueAsNumber`.
// TODO: To support RTL layout.