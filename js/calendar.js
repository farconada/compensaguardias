/**
 * CompensaGuardias - Generador y Gestor de Calendario
 * Modela el año completo, clasifica los días, estructura meses y semanas ISO.
 */

(function (global) {
  'use strict';

  const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const DAY_NAMES_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const DAY_NAMES_LONG = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  /**
   * Obtiene el número de semana ISO y el año ISO para una fecha UTC
   */
  function getIsoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
  }

  /**
   * Formatea fecha como YYYY-MM-DD
   */
  function formatDateKey(year, month, day) {
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
  }

  /**
   * Parsea el JSON del calendario (soporta el formato de calendario-2026.json y genéricos)
   */
  function parseCalendarData(rawData) {
    if (!rawData) {
      throw new Error('Datos de calendario vacíos o inválidos');
    }

    const year = Number(rawData.anio) || new Date().getFullYear();
    const festivosMap = new Map();
    const cierresMap = new Map();

    // 1. Festivos
    const festivosList = rawData.festivos_no_fin_de_semana || rawData.festivos || [];
    festivosList.forEach(f => {
      if (f.fecha) {
        festivosMap.set(f.fecha, {
          fecha: f.fecha,
          nombre: f.nombre || 'Día Festivo',
          tipo: f.tipo || 'Festivo',
          dia_semana: f.dia_semana || ''
        });
      }
    });

    // 2. Cierres energéticos y vacaciones obligatorias
    const cierresList = rawData.cierre_energetico_y_vacaciones_obligatorias || rawData.cierres || [];
    cierresList.forEach(item => {
      // Si tiene array 'dias'
      if (Array.isArray(item.dias)) {
        item.dias.forEach(d => {
          if (d.fecha) {
            cierresMap.set(d.fecha, {
              fecha: d.fecha,
              periodo: item.periodo || 'Cierre / Vacaciones',
              tipo_detalle: item.tipo_detalle || 'Cierre obligatorio',
              dia_semana: d.dia_semana || ''
            });
          }
        });
      } else if (item.fecha) {
        // En caso de array directo de días
        cierresMap.set(item.fecha, {
          fecha: item.fecha,
          periodo: item.periodo || 'Cierre / Vacaciones',
          tipo_detalle: item.tipo_detalle || 'Cierre obligatorio',
          dia_semana: item.dia_semana || ''
        });
      }
    });

    // 3. Generar todos los días del año
    const daysMap = new Map();
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const totalDaysInYear = isLeap ? 366 : 365;

    let normalCount = 0;
    let cierreCount = 0;
    let festivoCount = 0;

    let curr = new Date(startDate);
    while (curr <= endDate) {
      const y = curr.getUTCFullYear();
      const m = curr.getUTCMonth();
      const d = curr.getUTCDate();
      const dateKey = formatDateKey(y, m, d);
      const dayOfWeek1To7 = curr.getUTCDay() || 7; // 1 = Lun ... 7 = Dom
      const isWeekend = dayOfWeek1To7 === 6 || dayOfWeek1To7 === 7;
      const iso = getIsoWeek(curr);
      const weekKey = `${iso.year}-W${String(iso.week).padStart(2, '0')}`;

      let type = 'normal';
      let title = isWeekend ? 'Fin de semana estándar' : 'Día laboral estándar';
      let subtitle = 'Ponderación estándar de guardia';
      let period = null;

      if (festivosMap.has(dateKey)) {
        type = 'festivo';
        const fInfo = festivosMap.get(dateKey);
        title = fInfo.nombre;
        subtitle = `Festivo (${fInfo.tipo || 'Oficial'})`;
        festivoCount++;
      } else if (cierresMap.has(dateKey)) {
        type = 'cierre';
        const cInfo = cierresMap.get(dateKey);
        title = `${cInfo.tipo_detalle} (${cInfo.periodo})`;
        subtitle = `Periodo: ${cInfo.periodo}`;
        period = cInfo.periodo;
        cierreCount++;
      } else {
        normalCount++;
      }

      const dayObj = {
        dateKey,
        year: y,
        month: m,
        dayOfMonth: d,
        dayOfWeek: dayOfWeek1To7,
        dayNameShort: DAY_NAMES_SHORT[dayOfWeek1To7 - 1],
        dayNameLong: DAY_NAMES_LONG[dayOfWeek1To7 - 1],
        isWeekend,
        type,
        title,
        subtitle,
        period,
        isoWeek: iso.week,
        isoYear: iso.year,
        weekKey
      };

      daysMap.set(dateKey, dayObj);
      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    const dayCounts = {
      normal: normalCount,
      cierre: cierreCount,
      festivo: festivoCount,
      total: totalDaysInYear
    };

    // 4. Estructurar Semanas (W01 a W53)
    const weeksMap = new Map();

    // Para cada día del año, vincular a su semana
    daysMap.forEach(day => {
      if (!weeksMap.has(day.weekKey)) {
        weeksMap.set(day.weekKey, {
          weekKey: day.weekKey,
          weekNum: day.isoWeek,
          isoYear: day.isoYear,
          daysInBudgetYear: [],
          fullWeekDays: [] // los 7 días completos Lun-Dom
        });
      }
      weeksMap.get(day.weekKey).daysInBudgetYear.push(day);
    });

    // Generar la semana completa de 7 días (Lunes a Domingo) para cada semana
    weeksMap.forEach(w => {
      // Tomamos el primer día que tengamos en la semana
      const sampleDay = w.daysInBudgetYear[0];
      // Calculamos la fecha del lunes de esa semana
      const sampleDate = new Date(Date.UTC(sampleDay.year, sampleDay.month, sampleDay.dayOfMonth));
      const diffToMonday = (sampleDate.getUTCDay() || 7) - 1;
      const mondayDate = new Date(sampleDate);
      mondayDate.setUTCDate(mondayDate.getUTCDate() - diffToMonday);

      const fullDays = [];
      let cNorm = 0;
      let cCier = 0;
      let cFest = 0;

      for (let i = 0; i < 7; i++) {
        const dDate = new Date(mondayDate);
        dDate.setUTCDate(mondayDate.getUTCDate() + i);
        const y = dDate.getUTCFullYear();
        const m = dDate.getUTCMonth();
        const d = dDate.getUTCDate();
        const dKey = formatDateKey(y, m, d);

        if (daysMap.has(dKey)) {
          const dObj = daysMap.get(dKey);
          fullDays.push({ ...dObj, inYear: true });
          if (dObj.type === 'normal') cNorm++;
          else if (dObj.type === 'cierre') cCier++;
          else if (dObj.type === 'festivo') cFest++;
        } else {
          // Día fuera del año fiscal evaluado
          const dow = dDate.getUTCDay() || 7;
          fullDays.push({
            dateKey: dKey,
            year: y,
            month: m,
            dayOfMonth: d,
            dayOfWeek: dow,
            dayNameShort: DAY_NAMES_SHORT[dow - 1],
            dayNameLong: DAY_NAMES_LONG[dow - 1],
            isWeekend: dow === 6 || dow === 7,
            type: 'normal',
            title: `Fuera del año ${year}`,
            subtitle: `Año ${y}`,
            inYear: false
          });
        }
      }

      w.fullWeekDays = fullDays;
      w.startDate = fullDays[0].dateKey;
      w.endDate = fullDays[6].dateKey;
      w.counts = { normal: cNorm, cierre: cCier, festivo: cFest };

      // Etiqueta arquetipo y descripción
      if (cFest >= 2 && cCier >= 2) {
        w.archetype = 'Semana Santa / Intensiva';
        w.archetypeBadge = 'Especial Cierre + Festivos';
        w.badgeClass = 'badge-danger';
      } else if (cFest > 0 && cCier > 0) {
        w.archetype = 'Festivo y Cierre';
        w.archetypeBadge = `${cFest} Festivo(s) + ${cCier} Cierre(s)`;
        w.badgeClass = 'badge-warning';
      } else if (cFest > 0) {
        w.archetype = cFest === 1 ? '1 Día Festivo' : `${cFest} Días Festivos`;
        w.archetypeBadge = `${cFest} Festivo(s)`;
        w.badgeClass = 'badge-purple';
      } else if (cCier > 0) {
        w.archetype = `Cierre Obligatorio (${cCier} días)`;
        w.archetypeBadge = `${cCier} Cierre(s)`;
        w.badgeClass = 'badge-amber';
      } else {
        w.archetype = 'Semana Estándar';
        w.archetypeBadge = 'Estándar (7 días normales)';
        w.badgeClass = 'badge-blue';
      }
    });

    // 5. Estructurar Meses (12 meses para el render en cuadrícula)
    const months = [];
    for (let m = 0; m < 12; m++) {
      const firstDayOfMonth = new Date(Date.UTC(year, m, 1));
      const lastDayOfMonth = new Date(Date.UTC(year, m + 1, 0));
      const totalDaysInMonth = lastDayOfMonth.getUTCDate();

      // Cuadrícula del mes por semanas
      const monthWeeks = [];
      let currentWeekRow = [];

      // Días de padding antes del primer día del mes (Lunes = 1)
      const firstDayDow = firstDayOfMonth.getUTCDay() || 7;
      for (let p = 1; p < firstDayDow; p++) {
        currentWeekRow.push(null);
      }

      for (let d = 1; d <= totalDaysInMonth; d++) {
        const dateKey = formatDateKey(year, m, d);
        const dayObj = daysMap.get(dateKey);
        currentWeekRow.push(dayObj);

        if (currentWeekRow.length === 7) {
          // Obtener weekKey del primer día no nulo de la fila
          const sample = currentWeekRow.find(x => x !== null);
          monthWeeks.push({
            weekKey: sample.weekKey,
            weekNum: sample.isoWeek,
            days: currentWeekRow
          });
          currentWeekRow = [];
        }
      }

      // Padding final si la última semana no tiene 7 días
      if (currentWeekRow.length > 0) {
        const sample = currentWeekRow.find(x => x !== null);
        while (currentWeekRow.length < 7) {
          currentWeekRow.push(null);
        }
        monthWeeks.push({
          weekKey: sample.weekKey,
          weekNum: sample.isoWeek,
          days: currentWeekRow
        });
      }

      months.push({
        monthIndex: m,
        monthName: MONTH_NAMES[m],
        year,
        totalDays: totalDaysInMonth,
        weeks: monthWeeks
      });
    }

    return {
      year,
      dayCounts,
      daysMap,
      weeksList: Array.from(weeksMap.values()).sort((a, b) => a.weekNum - b.weekNum),
      weeksMap,
      months,
      MONTH_NAMES,
      DAY_NAMES_SHORT,
      DAY_NAMES_LONG
    };
  }

  const Calendar = {
    MONTH_NAMES,
    DAY_NAMES_SHORT,
    DAY_NAMES_LONG,
    getIsoWeek,
    formatDateKey,
    parseCalendarData
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Calendar;
  } else {
    global.Calendar = Calendar;
  }
})(typeof window !== 'undefined' ? window : globalThis);
