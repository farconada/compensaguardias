/**
 * CompensaGuardias - Controlador Principal de la Aplicación
 * Conecta el modelo del calendario, el motor de cálculo y la interfaz interactiva.
 */

(function () {
  'use strict';

  // Formateadores estándar en español
  const currencyFormatter = new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const percentFormatter = new Intl.NumberFormat('es-ES', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });

  const numberFormatter = new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });

  // Estado global de la aplicación
  const state = {
    calendarRaw: typeof DEFAULT_CALENDAR_2026 !== 'undefined' ? DEFAULT_CALENDAR_2026 : null,
    calendar: null,
    calcResult: null,

    // Configuración presupuestaria
    presupuestoSemanal: 600.0,
    semanasAnio: 52,
    presupuestoAnual: 31200.0,
    strictCeiling: true, // Por defecto activo para cumplir la restricción estricta

    // Ponderaciones
    weights: {
      normal: 1.0,
      cierre: 1.3,
      festivo: 1.8
    },

    // Selección e interfaz
    selectedWeekKey: '2026-W14', // Inicialmente destacamos Semana Santa por su riqueza en tipos de día
    activeTab: 'tab-calendar',
    tableFilter: 'all',
    tableSort: 'chrono',
    theme: localStorage.getItem('compensaguardias_theme') || 'light'
  };

  // Presets de ponderaciones
  const PRESETS = {
    recomendado: { normal: 1.0, cierre: 1.3, festivo: 1.8, label: 'Recomendado' },
    equitativo: { normal: 1.0, cierre: 1.0, festivo: 1.0, label: 'Equitativo' },
    festivos: { normal: 1.0, cierre: 1.4, festivo: 2.2, label: 'Compensación Festivos' },
    cierres: { normal: 1.0, cierre: 1.8, festivo: 1.6, label: 'Prioridad Cierres' }
  };

  /**
   * Inicialización al cargar el DOM
   */
  async function init() {
    // Aplicar tema guardado
    document.documentElement.setAttribute('data-theme', state.theme);
    updateThemeIcon();

    // Intentar cargar calendario-2026.json mediante fetch si está en servidor web
    try {
      const response = await fetch('./calendario-2026.json');
      if (response.ok) {
        state.calendarRaw = await response.json();
      }
    } catch (e) {
      // Si fetch falla por protocolo file://, state.calendarRaw ya tiene el fallback de DEFAULT_CALENDAR_2026
      console.info('Usando calendario local predefinido:', e.message);
    }

    if (!state.calendarRaw) {
      alert('Error: No se pudo cargar el archivo del calendario.');
      return;
    }

    // Parsear el calendario
    parseAndSetupCalendar();

    // Vincular eventos del usuario
    bindEvents();

    // Ejecutar primer cálculo y renderizado completo
    recalculate();
  }

  /**
   * Parsea los datos brutos del calendario
   */
  function parseAndSetupCalendar() {
    state.calendar = Calendar.parseCalendarData(state.calendarRaw);

    // Actualizar badges del header
    const chipYear = document.getElementById('chipYear');
    const chipNormal = document.getElementById('chipNormal');
    const chipCierre = document.getElementById('chipCierre');
    const chipFestivo = document.getElementById('chipFestivo');

    if (chipYear) chipYear.textContent = state.calendar.year;
    if (chipNormal) chipNormal.textContent = `${state.calendar.dayCounts.normal} Normales`;
    if (chipCierre) chipCierre.textContent = `${state.calendar.dayCounts.cierre} Cierres`;
    if (chipFestivo) chipFestivo.textContent = `${state.calendar.dayCounts.festivo} Festivos`;

    // Si la semana seleccionada no existe en el nuevo calendario, seleccionar la primera
    if (!state.calendar.weeksMap.has(state.selectedWeekKey)) {
      const firstWeek = state.calendar.weeksList[0];
      if (firstWeek) state.selectedWeekKey = firstWeek.weekKey;
    }
  }

  /**
   * Recalcula todas las tasas y actualiza toda la interfaz
   */
  function recalculate() {
    if (!state.calendar) return;

    // Calcular distribución ponderada con el motor
    state.calcResult = Calculator.calculateRates({
      presupuestoAnual: state.presupuestoAnual,
      dayCounts: state.calendar.dayCounts,
      weights: state.weights,
      strictCeiling: state.strictCeiling
    });

    // Renderizar componentes
    renderBudgetControls();
    renderWeightControls();
    renderRateCards();
    renderCalendarGrid();
    renderWeekInspector();
    renderWeeksTable();
    renderAuditPanel();
  }

  /**
   * Renderiza el control de presupuestos y la barra de restricción
   */
  function renderBudgetControls() {
    const inputWeekly = document.getElementById('inputPresupuestoSemanal');
    const inputAnnual = document.getElementById('inputPresupuestoAnual');
    const inputWeeksCount = document.getElementById('inputSemanasAnio');
    const strictCeilingCheckbox = document.getElementById('strictCeilingToggle');

    if (inputWeekly && document.activeElement !== inputWeekly) {
      inputWeekly.value = state.presupuestoSemanal.toFixed(2);
    }
    if (inputAnnual && document.activeElement !== inputAnnual) {
      inputAnnual.value = state.presupuestoAnual.toFixed(2);
    }
    if (inputWeeksCount && document.activeElement !== inputWeeksCount) {
      inputWeeksCount.value = state.semanasAnio;
    }
    if (strictCeilingCheckbox) {
      strictCeilingCheckbox.checked = state.strictCeiling;
    }

    // Barra de estado presupuestario
    const res = state.calcResult;
    const ceilingValEl = document.getElementById('budgetCeilingVal');
    const costValEl = document.getElementById('budgetCostVal');
    const marginValEl = document.getElementById('budgetMarginVal');
    const progressBar = document.getElementById('budgetProgressBar');
    const statusBadge = document.getElementById('budgetStatusBadge');

    if (ceilingValEl) ceilingValEl.textContent = currencyFormatter.format(res.presupuestoAnual);
    if (costValEl) costValEl.textContent = currencyFormatter.format(res.costeAnualRedondeado);

    if (marginValEl) {
      const margin = res.margenRestante;
      marginValEl.textContent = `${margin >= 0 ? '+' : ''}${currencyFormatter.format(margin)}`;
      marginValEl.className = margin >= 0 ? 'text-success' : 'text-danger';
    }

    if (progressBar) {
      const pct = Math.min(100, (res.costeAnualRedondeado / res.presupuestoAnual) * 100);
      progressBar.style.width = `${pct}%`;
      if (res.costeAnualRedondeado > res.presupuestoAnual) {
        progressBar.classList.add('exceeded');
      } else {
        progressBar.classList.remove('exceeded');
      }
    }

    if (statusBadge) {
      if (res.cumpleRestriccion && res.costeAnualRedondeado <= res.presupuestoAnual) {
        statusBadge.className = 'badge badge-success';
        statusBadge.innerHTML = `🛡️ Presupuesto respetado (${res.porcentajeConsumido.toFixed(2)}%)`;
      } else {
        statusBadge.className = 'badge badge-danger';
        statusBadge.innerHTML = `⚠️ Excede presupuesto en ${currencyFormatter.format(Math.abs(res.margenRestante))}`;
      }
    }
  }

  /**
   * Renderiza los sliders e inputs numéricos de ponderaciones
   */
  function renderWeightControls() {
    ['normal', 'cierre', 'festivo'].forEach(type => {
      const slider = document.getElementById(`sliderWeight_${type}`);
      const numInput = document.getElementById(`numWeight_${type}`);
      const val = state.weights[type];

      if (slider && document.activeElement !== slider) slider.value = val;
      if (numInput && document.activeElement !== numInput) numInput.value = val.toFixed(2);
    });
  }

  /**
   * Renderiza las 4 tarjetas de tarifas y los arquetipos rápidos
   */
  function renderRateCards() {
    const res = state.calcResult;
    if (!res) return;

    // Métricas principales
    const elBase = document.getElementById('valBaseGuardia');
    const elNorm = document.getElementById('valPrecioNormal');
    const elCier = document.getElementById('valPrecioCierre');
    const elFest = document.getElementById('valPrecioFestivo');

    if (elBase) elBase.textContent = currencyFormatter.format(res.valorBase);
    if (elNorm) elNorm.textContent = currencyFormatter.format(res.precios.normal);
    if (elCier) elCier.textContent = currencyFormatter.format(res.precios.cierre);
    if (elFest) elFest.textContent = currencyFormatter.format(res.precios.festivo);

    // Suma ponderada en hint
    const hintBase = document.getElementById('hintBaseFormula');
    if (hintBase) {
      hintBase.textContent = `Σ ponderada: ${res.sumaPonderada} pts`;
    }

    // Arquetipos de semana
    const archetypes = Calculator.getWeekArchetypes(res.precios);
    const container = document.getElementById('archetypesContainer');
    if (container) {
      container.innerHTML = archetypes.map(a => `
        <div class="archetype-chip">
          <div class="archetype-chip-header">
            <span>${a.title}</span>
            <span class="badge badge-${a.badgeColor}">${a.badge}</span>
          </div>
          <div class="archetype-chip-price">${currencyFormatter.format(a.cost)}</div>
          <div class="archetype-chip-desc">${a.subtitle}</div>
        </div>
      `).join('');
    }
  }

  /**
   * Renderiza la cuadrícula de los 12 meses del año
   */
  function renderCalendarGrid() {
    const container = document.getElementById('monthsContainer');
    if (!container || !state.calendar) return;

    const rates = state.calcResult.precios;
    const monthsHtml = state.calendar.months.map(m => {
      const rowsHtml = m.weeks.map(w => {
        const isSelectedWeek = w.weekKey === state.selectedWeekKey;
        const weekCls = isSelectedWeek ? 'tr-week-selected' : '';

        const daysCellsHtml = w.days.map(d => {
          if (!d) {
            return `<td><div class="day-cell day-empty"></div></td>`;
          }

          const price = rates[d.type];
          const isSelectedDay = isSelectedWeek;
          const tooltip = `${d.dayNameLong} ${d.dayOfMonth} de ${Calendar.MONTH_NAMES[d.month]}: ${d.title} (${currencyFormatter.format(price)})`;

          return `
            <td>
              <div 
                class="day-cell day-${d.type} ${isSelectedDay ? 'day-active' : ''}" 
                title="${tooltip}"
                data-week-key="${d.weekKey}"
                data-date-key="${d.dateKey}">
                ${d.dayOfMonth}
              </div>
            </td>
          `;
        }).join('');

        return `
          <tr class="${weekCls}" data-week-key="${w.weekKey}">
            <td>
              <span class="week-num-cell ${isSelectedWeek ? 'selected' : ''}" title="Semana ${w.weekNum} (Clic para inspeccionar)">
                W${String(w.weekNum).padStart(2, '0')}
              </span>
            </td>
            ${daysCellsHtml}
          </tr>
        `;
      }).join('');

      return `
        <div class="month-card">
          <div class="month-title">
            <span>${m.monthName}</span>
            <span class="month-title-count">${m.totalDays} días</span>
          </div>
          <table class="month-table">
            <thead>
              <tr>
                <th class="th-week" title="Semana ISO">Sem</th>
                <th>L</th><th>M</th><th>X</th><th>J</th><th>V</th><th>S</th><th>D</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }).join('');

    container.innerHTML = monthsHtml;
  }

  /**
   * Renderiza el panel Inspector de la semana seleccionada
   */
  function renderWeekInspector() {
    const week = state.calendar.weeksMap.get(state.selectedWeekKey);
    if (!week) return;

    const rates = state.calcResult.precios;
    const weekCostObj = Calculator.calculateWeekCost(week.daysInBudgetYear, rates);
    const fullWeekCostObj = Calculator.calculateWeekCost(week.fullWeekDays, rates);

    // Elementos del Inspector
    const badgeEl = document.getElementById('inspectorWeekBadge');
    const rangeEl = document.getElementById('inspectorDatesRange');
    const amountEl = document.getElementById('inspectorAmountValue');
    const diffEl = document.getElementById('inspectorAmountDiff');
    const listEl = document.getElementById('inspectorDaysList');
    const archetypePillEl = document.getElementById('inspectorArchetypePill');

    if (badgeEl) {
      badgeEl.innerHTML = `Semana ${String(week.weekNum).padStart(2, '0')} <span class="badge ${week.badgeClass}">${week.archetypeBadge}</span>`;
    }

    if (rangeEl) {
      const dStart = new Date(week.startDate + 'T00:00:00Z');
      const dEnd = new Date(week.endDate + 'T00:00:00Z');
      const optFormat = { day: 'numeric', month: 'short' };
      rangeEl.textContent = `${dStart.toLocaleDateString('es-ES', optFormat)} - ${dEnd.toLocaleDateString('es-ES', optFormat)} (${state.calendar.year})`;
    }

    if (archetypePillEl) {
      archetypePillEl.textContent = week.archetype;
    }

    // Importe total exacto a percibir en esa semana
    if (amountEl) {
      amountEl.textContent = currencyFormatter.format(weekCostObj.total);
    }

    if (diffEl) {
      const avgWeeklyBudget = state.presupuestoSemanal;
      const diff = weekCostObj.total - avgWeeklyBudget;
      const diffPct = avgWeeklyBudget > 0 ? (diff / avgWeeklyBudget) * 100 : 0;

      if (Math.abs(diff) < 0.05) {
        diffEl.className = 'inspector-amount-diff diff-equal';
        diffEl.textContent = `Equivalente al presupuesto base semanal (${currencyFormatter.format(avgWeeklyBudget)})`;
      } else if (diff > 0) {
        diffEl.className = 'inspector-amount-diff diff-positive';
        diffEl.textContent = `+${currencyFormatter.format(diff)} (+${diffPct.toFixed(1)}%) vs media semanal (${currencyFormatter.format(avgWeeklyBudget)})`;
      } else {
        diffEl.className = 'inspector-amount-diff diff-negative';
        diffEl.textContent = `${currencyFormatter.format(diff)} (${diffPct.toFixed(1)}%) vs media semanal (${currencyFormatter.format(avgWeeklyBudget)})`;
      }
    }

    // Lista desglosada día por día
    if (listEl) {
      listEl.innerHTML = week.fullWeekDays.map(d => {
        const rate = rates[d.type];
        const isExcludedFromBudget = !d.inYear;
        const typeClass = `badge-${d.type}`;

        return `
          <div class="inspector-day-item" style="${isExcludedFromBudget ? 'opacity: 0.55;' : ''}">
            <div class="inspector-day-info">
              <div class="inspector-day-weekday">
                <span>${d.dayNameShort} ${d.dayOfMonth} ${Calendar.MONTH_NAMES[d.month].substring(0, 3)}</span>
                <span class="badge ${typeClass}">${d.type.toUpperCase()}</span>
                ${isExcludedFromBudget ? '<span class="badge badge-subtle">Año ' + d.year + '</span>' : ''}
              </div>
              <div class="inspector-day-title">${d.title}</div>
            </div>
            <div class="inspector-day-rate">
              ${isExcludedFromBudget ? '—' : currencyFormatter.format(rate)}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  /**
   * Renderiza la tabla completa de semanas (W01 a W53) con filtros
   */
  function renderWeeksTable() {
    const tbody = document.getElementById('weeksTableBody');
    if (!tbody || !state.calendar) return;

    const rates = state.calcResult.precios;
    let weeks = state.calendar.weeksList.map(w => {
      const costObj = Calculator.calculateWeekCost(w.daysInBudgetYear, rates);
      return {
        ...w,
        totalCost: costObj.total,
        diffBase: costObj.total - state.presupuestoSemanal
      };
    });

    // Filtros
    if (state.tableFilter === 'standard') {
      weeks = weeks.filter(w => w.counts.festivo === 0 && w.counts.cierre === 0);
    } else if (state.tableFilter === 'festivos') {
      weeks = weeks.filter(w => w.counts.festivo > 0);
    } else if (state.tableFilter === 'cierres') {
      weeks = weeks.filter(w => w.counts.cierre > 0);
    }

    // Ordenación
    if (state.tableSort === 'price-desc') {
      weeks.sort((a, b) => b.totalCost - a.totalCost);
    } else if (state.tableSort === 'price-asc') {
      weeks.sort((a, b) => a.totalCost - b.totalCost);
    } else {
      weeks.sort((a, b) => a.weekNum - b.weekNum);
    }

    tbody.innerHTML = weeks.map(w => {
      const isSelected = w.weekKey === state.selectedWeekKey;
      const dStart = new Date(w.startDate + 'T00:00:00Z');
      const dEnd = new Date(w.endDate + 'T00:00:00Z');
      const optFormat = { day: '2-digit', month: '2-digit' };
      const rangeStr = `${dStart.toLocaleDateString('es-ES', optFormat)} - ${dEnd.toLocaleDateString('es-ES', optFormat)}`;

      return `
        <tr class="${isSelected ? 'selected' : ''}" data-week-key="${w.weekKey}">
          <td class="col-mono">W${String(w.weekNum).padStart(2, '0')}</td>
          <td>${rangeStr}</td>
          <td><span class="badge ${w.badgeClass}">${w.archetype}</span></td>
          <td>
            <span class="badge badge-normal">${w.counts.normal}N</span>
            ${w.counts.cierre > 0 ? `<span class="badge badge-cierre">${w.counts.cierre}C</span>` : ''}
            ${w.counts.festivo > 0 ? `<span class="badge badge-festivo">${w.counts.festivo}F</span>` : ''}
          </td>
          <td class="col-mono" style="font-size: 0.95rem;">${currencyFormatter.format(w.totalCost)}</td>
          <td class="${w.diffBase > 0 ? 'text-danger' : (w.diffBase < 0 ? 'text-success' : 'text-muted')} col-mono">
            ${w.diffBase >= 0 ? '+' : ''}${currencyFormatter.format(w.diffBase)}
          </td>
          <td>
            <button class="btn btn-sm btn-subtle btn-inspect-week" data-week-key="${w.weekKey}">
              Ver en Calendario 🔍
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Actualizar contadores de pestañas
    const countAll = state.calendar.weeksList.length;
    const countStd = state.calendar.weeksList.filter(w => w.counts.festivo === 0 && w.counts.cierre === 0).length;
    const countFest = state.calendar.weeksList.filter(w => w.counts.festivo > 0).length;
    const countCier = state.calendar.weeksList.filter(w => w.counts.cierre > 0).length;

    const elAll = document.getElementById('countFilterAll');
    const elStd = document.getElementById('countFilterStd');
    const elFest = document.getElementById('countFilterFest');
    const elCier = document.getElementById('countFilterCier');

    if (elAll) elAll.textContent = countAll;
    if (elStd) elStd.textContent = countStd;
    if (elFest) elFest.textContent = countFest;
    if (elCier) elCier.textContent = countCier;
  }

  /**
   * Renderiza la tabla de auditoría matemática y conciliación estricta
   */
  function renderAuditPanel() {
    const res = state.calcResult;
    if (!res) return;

    const tbody = document.getElementById('auditTableBody');
    if (!tbody) return;

    const rows = [
      {
        tipo: 'Día Normal',
        badge: 'badge-normal',
        dias: res.dayCounts.normal,
        peso: res.weights.normal,
        pts: res.dayCounts.normal * res.weights.normal,
        precioExacto: res.preciosExactos.normal,
        precioNomina: res.precios.normal,
        subtotal: res.dayCounts.normal * res.precios.normal
      },
      {
        tipo: 'Cierre / Vacaciones',
        badge: 'badge-cierre',
        dias: res.dayCounts.cierre,
        peso: res.weights.cierre,
        pts: res.dayCounts.cierre * res.weights.cierre,
        precioExacto: res.preciosExactos.cierre,
        precioNomina: res.precios.cierre,
        subtotal: res.dayCounts.cierre * res.precios.cierre
      },
      {
        tipo: 'Día Festivo',
        badge: 'badge-festivo',
        dias: res.dayCounts.festivo,
        peso: res.weights.festivo,
        pts: res.dayCounts.festivo * res.weights.festivo,
        precioExacto: res.preciosExactos.festivo,
        precioNomina: res.precios.festivo,
        subtotal: res.dayCounts.festivo * res.precios.festivo
      }
    ];

    tbody.innerHTML = rows.map(r => {
      const pct = (r.subtotal / res.presupuestoAnual) * 100;
      return `
        <tr>
          <td><span class="badge ${r.badge}">${r.tipo}</span></td>
          <td class="col-mono">${r.dias}</td>
          <td class="col-mono">× ${r.peso.toFixed(2)}</td>
          <td class="col-mono">${r.pts.toFixed(2)}</td>
          <td class="col-mono">${numberFormatter.format(r.precioExacto)} €</td>
          <td class="col-mono" style="font-weight: 800;">${currencyFormatter.format(r.precioNomina)}</td>
          <td class="col-mono">${currencyFormatter.format(r.subtotal)}</td>
          <td class="col-mono">${pct.toFixed(2)}%</td>
        </tr>
      `;
    }).join('');

    // Actualizar fila de totales
    const totalPtsEl = document.getElementById('auditTotalPts');
    const totalCostEl = document.getElementById('auditTotalCost');
    const totalCeilingEl = document.getElementById('auditTotalCeiling');
    const totalMarginEl = document.getElementById('auditTotalMargin');
    const totalDaysEl = document.getElementById('auditTotalDays');

    if (totalDaysEl) totalDaysEl.textContent = res.totalDays;
    if (totalPtsEl) totalPtsEl.textContent = res.sumaPonderada.toFixed(2);
    if (totalCostEl) totalCostEl.textContent = currencyFormatter.format(res.costeAnualRedondeado);
    if (totalCeilingEl) totalCeilingEl.textContent = currencyFormatter.format(res.presupuestoAnual);
    if (totalMarginEl) {
      totalMarginEl.textContent = `${res.margenRestante >= 0 ? '+' : ''}${currencyFormatter.format(res.margenRestante)}`;
      totalMarginEl.className = res.margenRestante >= 0 ? 'col-mono text-success' : 'col-mono text-danger';
    }
  }

  /**
   * Conecta todos los eventos de interacción de la UI
   */
  function bindEvents() {
    // 1. Presupuesto semanal
    const inputWeekly = document.getElementById('inputPresupuestoSemanal');
    if (inputWeekly) {
      inputWeekly.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          state.presupuestoSemanal = val;
          state.presupuestoAnual = val * state.semanasAnio;
          recalculate();
        }
      });
    }

    // 2. Presupuesto anual (sincronización bidireccional)
    const inputAnnual = document.getElementById('inputPresupuestoAnual');
    if (inputAnnual) {
      inputAnnual.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          state.presupuestoAnual = val;
          state.presupuestoSemanal = val / state.semanasAnio;
          recalculate();
        }
      });
    }

    // 3. Semanas del año (inputs y píldoras)
    const inputWeeksCount = document.getElementById('inputSemanasAnio');
    if (inputWeeksCount) {
      inputWeeksCount.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          state.semanasAnio = val;
          state.presupuestoAnual = state.presupuestoSemanal * val;
          recalculate();
        }
      });
    }

    document.querySelectorAll('.pill-week-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pill-week-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const weeksVal = parseFloat(btn.getAttribute('data-weeks'));
        state.semanasAnio = weeksVal;
        state.presupuestoAnual = state.presupuestoSemanal * weeksVal;
        recalculate();
      });
    });

    // 4. Toggle de restricción estricta anti-desbordamiento
    const strictCeilingToggle = document.getElementById('strictCeilingToggle');
    if (strictCeilingToggle) {
      strictCeilingToggle.addEventListener('change', (e) => {
        state.strictCeiling = e.target.checked;
        recalculate();
      });
    }

    // 5. Sliders e inputs numéricos de ponderaciones
    ['normal', 'cierre', 'festivo'].forEach(type => {
      const slider = document.getElementById(`sliderWeight_${type}`);
      const numInput = document.getElementById(`numWeight_${type}`);

      if (slider) {
        slider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          state.weights[type] = val;
          if (numInput) numInput.value = val.toFixed(2);
          // Quitar active de presets porque es custom
          document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
          recalculate();
        });
      }

      if (numInput) {
        numInput.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          if (!isNaN(val) && val >= 0.01) {
            state.weights[type] = val;
            if (slider) slider.value = val;
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            recalculate();
          }
        });
      }
    });

    // 6. Botones de Presets de ponderaciones
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const presetKey = btn.getAttribute('data-preset');
        if (PRESETS[presetKey]) {
          document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.weights = { ...PRESETS[presetKey] };
          recalculate();
        }
      });
    });

    // 7. Clics en el calendario (delegación en monthsContainer)
    const monthsContainer = document.getElementById('monthsContainer');
    if (monthsContainer) {
      monthsContainer.addEventListener('click', (e) => {
        const cell = e.target.closest('[data-week-key]');
        if (cell) {
          const weekKey = cell.getAttribute('data-week-key');
          if (weekKey && state.calendar.weeksMap.has(weekKey)) {
            state.selectedWeekKey = weekKey;
            renderCalendarGrid();
            renderWeekInspector();
            renderWeeksTable();
          }
        }
      });
    }

    // 8. Navegación en el Inspector de Semana (< Anterior / Siguiente >)
    const btnPrevWeek = document.getElementById('btnPrevWeek');
    const btnNextWeek = document.getElementById('btnNextWeek');

    if (btnPrevWeek) {
      btnPrevWeek.addEventListener('click', () => {
        const weeksList = state.calendar.weeksList;
        const currIdx = weeksList.findIndex(w => w.weekKey === state.selectedWeekKey);
        if (currIdx > 0) {
          state.selectedWeekKey = weeksList[currIdx - 1].weekKey;
          renderCalendarGrid();
          renderWeekInspector();
          renderWeeksTable();
        }
      });
    }

    if (btnNextWeek) {
      btnNextWeek.addEventListener('click', () => {
        const weeksList = state.calendar.weeksList;
        const currIdx = weeksList.findIndex(w => w.weekKey === state.selectedWeekKey);
        if (currIdx < weeksList.length - 1) {
          state.selectedWeekKey = weeksList[currIdx + 1].weekKey;
          renderCalendarGrid();
          renderWeekInspector();
          renderWeeksTable();
        }
      });
    }

    // 9. Clics en la tabla de semanas (delegación)
    const tableBody = document.getElementById('weeksTableBody');
    if (tableBody) {
      tableBody.addEventListener('click', (e) => {
        const target = e.target.closest('[data-week-key]');
        if (target) {
          const weekKey = target.getAttribute('data-week-key');
          if (weekKey) {
            state.selectedWeekKey = weekKey;
            // Si el clic fue en "Ver en Calendario", cambiar a la pestaña de calendario
            if (e.target.closest('.btn-inspect-week')) {
              switchTab('tab-calendar');
            }
            renderCalendarGrid();
            renderWeekInspector();
            renderWeeksTable();
          }
        }
      });
    }

    // 10. Filtros y ordenación de la tabla de semanas
    document.querySelectorAll('.filter-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.tableFilter = btn.getAttribute('data-filter');
        renderWeeksTable();
      });
    });

    const sortSelect = document.getElementById('selectWeeksSort');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        state.tableSort = e.target.value;
        renderWeeksTable();
      });
    }

    // 11. Pestañas principales
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        switchTab(targetTab);
      });
    });

    // 12. Alternar Modo Oscuro / Modo Claro
    const btnThemeToggle = document.getElementById('btnThemeToggle');
    if (btnThemeToggle) {
      btnThemeToggle.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', state.theme);
        localStorage.setItem('compensaguardias_theme', state.theme);
        updateThemeIcon();
      });
    }

    // 13. Carga de archivo JSON personalizado
    const fileInput = document.getElementById('jsonFileInput');
    const btnUpload = document.getElementById('btnUploadJson');

    if (btnUpload && fileInput) {
      btnUpload.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', handleFileUpload);
    }

    // 14. Restablecer valores
    const btnReset = document.getElementById('btnResetDefaults');
    if (btnReset) {
      btnReset.addEventListener('click', resetDefaults);
    }

    // 15. Exportaciones (CSV y JSON)
    const btnExportCsv = document.getElementById('btnExportCsv');
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', exportCsv);
    }

    const btnExportJson = document.getElementById('btnExportJson');
    if (btnExportJson) {
      btnExportJson.addEventListener('click', exportJson);
    }

    // 16. Imprimir
    const btnPrint = document.getElementById('btnPrintReport');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => window.print());
    }
  }

  /**
   * Cambia de pestaña activa
   */
  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('active', c.id === tabId);
    });
  }

  /**
   * Actualiza el icono de tema claro/oscuro
   */
  function updateThemeIcon() {
    const btn = document.getElementById('btnThemeToggle');
    if (btn) {
      btn.innerHTML = state.theme === 'dark' ? '☀️' : '🌙';
      btn.title = state.theme === 'dark' ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro';
    }
  }

  /**
   * Manejo de la subida de un nuevo archivo JSON de calendario
   */
  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        state.calendarRaw = json;
        parseAndSetupCalendar();
        recalculate();
        alert(`¡Calendario cargado con éxito para el año ${state.calendar.year}!`);
      } catch (err) {
        alert('Error al leer el archivo JSON: formato inválido. ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  /**
   * Restablece todos los parámetros a los valores por defecto
   */
  function resetDefaults() {
    if (confirm('¿Restablecer el presupuesto a 600 €/semana y las ponderaciones por defecto?')) {
      state.presupuestoSemanal = 600.0;
      state.semanasAnio = 52;
      state.presupuestoAnual = 31200.0;
      state.strictCeiling = true;
      state.weights = { normal: 1.0, cierre: 1.3, festivo: 1.8 };
      state.selectedWeekKey = '2026-W14';

      if (typeof DEFAULT_CALENDAR_2026 !== 'undefined') {
        state.calendarRaw = DEFAULT_CALENDAR_2026;
        parseAndSetupCalendar();
      }

      document.querySelectorAll('.pill-week-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-weeks') === '52');
      });

      document.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-preset') === 'recomendado');
      });

      recalculate();
    }
  }

  /**
   * Exporta el desglose completo de las 53 semanas a CSV para Excel / Nóminas
   */
  function exportCsv() {
    const rates = state.calcResult.precios;
    const weeks = state.calendar.weeksList;

    let csv = '\uFEFF'; // BOM para compatibilidad UTF-8 en Excel
    csv += 'CompensaGuardias - Presupuesto Anual de Guardias\n';
    csv += `Año:;${state.calendar.year};Presupuesto Anual Límite:;${state.presupuestoAnual.toFixed(2)} €\n`;
    csv += `Tarifa Normal (€):;${rates.normal.toFixed(2)};Tarifa Cierre (€):;${rates.cierre.toFixed(2)};Tarifa Festivo (€):;${rates.festivo.toFixed(2)}\n\n`;
    csv += 'Semana;Fecha Inicio;Fecha Fin;Arquetipo;Dias Normales;Dias Cierre;Dias Festivo;Total Semana (€);Desviacion vs Media (€)\n';

    weeks.forEach(w => {
      const costObj = Calculator.calculateWeekCost(w.daysInBudgetYear, rates);
      const diff = costObj.total - state.presupuestoSemanal;
      csv += `${w.weekKey};${w.startDate};${w.endDate};"${w.archetype}";${w.counts.normal};${w.counts.cierre};${w.counts.festivo};${costObj.total.toFixed(2)};${diff.toFixed(2)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `guardias-${state.calendar.year}-presupuesto.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Exporta la configuración y cálculo a JSON
   */
  function exportJson() {
    const dataToExport = {
      app: 'CompensaGuardias',
      timestamp: new Date().toISOString(),
      year: state.calendar.year,
      presupuestoConfig: {
        presupuestoSemanal: state.presupuestoSemanal,
        semanasAnio: state.semanasAnio,
        presupuestoAnual: state.presupuestoAnual,
        strictCeiling: state.strictCeiling
      },
      weights: state.weights,
      results: state.calcResult,
      weeksSummary: state.calendar.weeksList.map(w => {
        const cost = Calculator.calculateWeekCost(w.daysInBudgetYear, state.calcResult.precios);
        return {
          weekKey: w.weekKey,
          startDate: w.startDate,
          endDate: w.endDate,
          archetype: w.archetype,
          counts: w.counts,
          totalCost: cost.total
        };
      })
    };

    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `compensaguardias-simulacion-${state.calendar.year}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Ejecutar al iniciar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
