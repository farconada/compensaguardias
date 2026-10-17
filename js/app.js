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
    theme: localStorage.getItem('compensaguardias_theme') || 'light',

    // Módulo de Asignación y Reparto de Guardias
    teamMembers: (function () {
      if (typeof AssignmentEngine !== 'undefined' && AssignmentEngine.DEFAULT_MEMBERS) {
        return JSON.parse(JSON.stringify(AssignmentEngine.DEFAULT_MEMBERS));
      }
      return [
        { id: 'm1', name: 'Carlos Santana', colorIndex: 0 },
        { id: 'm2', name: 'Lucía Méndez', colorIndex: 1 },
        { id: 'm3', name: 'David Romero', colorIndex: 2 },
        { id: 'm4', name: 'Elena Navarro', colorIndex: 3 }
      ];
    })(),
    assignmentStrategy: 'economic', // 'economic', 'holidays', 'mixed', 'round_robin'
    holidaysEquivalenceEnabled: true,
    vacationWeight: 0.5,
    assignments: {}, // weekKey -> memberId
    teamMetrics: null
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
   * @param {boolean} [forceReassign=false] - Si es true, vuelve a ejecutar el algoritmo de reparto
   */
  function recalculate(forceReassign = false) {
    if (!state.calendar) return;

    // Calcular distribución ponderada con el motor
    state.calcResult = Calculator.calculateRates({
      presupuestoAnual: state.presupuestoAnual,
      dayCounts: state.calendar.dayCounts,
      weights: state.weights,
      strictCeiling: state.strictCeiling
    });

    // Preparar datos de semanas para el módulo de asignación
    if (typeof AssignmentEngine !== 'undefined') {
      const weeksData = AssignmentEngine.prepareWeeksData(
        state.calendar.weeksList,
        state.calcResult.precios,
        {
          vacationWeight: state.vacationWeight,
          holidaysEquivalenceEnabled: state.holidaysEquivalenceEnabled
        }
      );

      // Si no hay asignaciones, se forzó reasignación, o faltan semanas por asignar:
      const totalWeeks = state.calendar.weeksList.length;
      const assignedCount = Object.keys(state.assignments).length;
      const validMemberIds = new Set(state.teamMembers.map(m => m.id));

      let hasInvalidAssignments = false;
      for (const [wKey, mId] of Object.entries(state.assignments)) {
        if (!validMemberIds.has(mId)) {
          hasInvalidAssignments = true;
          break;
        }
      }

      if (forceReassign || assignedCount !== totalWeeks || hasInvalidAssignments) {
        state.assignments = AssignmentEngine.runStrategy(
          state.assignmentStrategy,
          weeksData,
          state.teamMembers
        );
      }

      // Calcular métricas del equipo con las asignaciones actuales
      state.teamMetrics = AssignmentEngine.calculateTeamMetrics(
        weeksData,
        state.assignments,
        state.teamMembers
      );
    }

    // Renderizar componentes
    renderBudgetControls();
    renderWeightControls();
    renderRateCards();
    renderCalendarGrid();
    renderWeekInspector();
    renderWeeksTable();
    renderTeamAssignmentTab();
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

        const assignedMemberId = state.assignments ? state.assignments[w.weekKey] : null;
        const member = state.teamMembers ? state.teamMembers.find(m => m.id === assignedMemberId) : null;
        const pal = member && typeof AssignmentEngine !== 'undefined'
          ? AssignmentEngine.MEMBER_PALETTE[member.colorIndex % AssignmentEngine.MEMBER_PALETTE.length]
          : null;

        const assignedMicroTag = member && pal ? `
          <span class="week-assignee-micro" style="background-color: ${pal.color}; color: #ffffff;" title="Asignada a ${member.name}">
            ${member.name.split(' ')[0]}
          </span>
        ` : '';

        return `
          <tr class="${weekCls}" data-week-key="${w.weekKey}">
            <td>
              <span class="week-num-cell ${isSelectedWeek ? 'selected' : ''}" title="Semana ${w.weekNum} ${member ? '— Asignada a ' + member.name : ''} (Clic para inspeccionar)">
                <span>W${String(w.weekNum).padStart(2, '0')}</span>
                ${assignedMicroTag}
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

    // Responsable asignado en el Inspector
    const assigneeSelect = document.getElementById('inspectorAssigneeSelect');
    const assigneeBadge = document.getElementById('inspectorAssigneeBadge');
    const assigneeDot = document.getElementById('inspectorAssigneeDot');
    const assigneeName = document.getElementById('inspectorAssigneeName');

    const currentAssignedId = state.assignments ? state.assignments[week.weekKey] : null;
    const currentMember = state.teamMembers ? state.teamMembers.find(m => m.id === currentAssignedId) : null;
    const currentPalette = currentMember && typeof AssignmentEngine !== 'undefined'
      ? AssignmentEngine.MEMBER_PALETTE[currentMember.colorIndex % AssignmentEngine.MEMBER_PALETTE.length]
      : null;

    if (assigneeName && currentMember) {
      assigneeName.textContent = currentMember.name;
    }
    if (assigneeDot && currentPalette) {
      assigneeDot.style.backgroundColor = currentPalette.color;
    }
    if (assigneeBadge && currentPalette) {
      assigneeBadge.style.backgroundColor = currentPalette.bg;
      assigneeBadge.style.borderColor = currentPalette.border;
      assigneeBadge.style.color = currentPalette.textDark;
    }

    if (assigneeSelect && state.teamMembers) {
      assigneeSelect.innerHTML = state.teamMembers.map(m => {
        return `<option value="${m.id}" ${m.id === currentAssignedId ? 'selected' : ''}>${m.name}</option>`;
      }).join('');
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

      const assignedId = state.assignments ? state.assignments[w.weekKey] : null;
      const assignedMember = state.teamMembers ? state.teamMembers.find(m => m.id === assignedId) : null;
      const pal = assignedMember && typeof AssignmentEngine !== 'undefined'
        ? AssignmentEngine.MEMBER_PALETTE[assignedMember.colorIndex % AssignmentEngine.MEMBER_PALETTE.length]
        : null;

      const memberOptionsHtml = (state.teamMembers || []).map(m => {
        return `<option value="${m.id}" ${m.id === assignedId ? 'selected' : ''}>${m.name}</option>`;
      }).join('');

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
            <select 
              class="assignee-select-cell week-table-assignee-select" 
              data-week-key="${w.weekKey}"
              style="${pal ? 'border-left: 3px solid ' + pal.color + ';' : ''}"
              title="Cambiar responsable de la guardia">
              ${memberOptionsHtml}
            </select>
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
   * Renderiza el módulo completo de Asignación y Reparto de Guardias
   */
  function renderTeamAssignmentTab() {
    if (!state.calendar || !state.teamMetrics || typeof AssignmentEngine === 'undefined') return;

    const metrics = state.teamMetrics;
    const disp = metrics.dispersion;
    const avg = metrics.averages;
    const tot = metrics.totals;

    // 1. Controles de configuración superior
    const selectStrategy = document.getElementById('selectAssignmentStrategy');
    if (selectStrategy && document.activeElement !== selectStrategy) {
      selectStrategy.value = state.assignmentStrategy;
    }

    const toggleEq = document.getElementById('toggleHolidayEquivalence');
    if (toggleEq) {
      toggleEq.checked = state.holidaysEquivalenceEnabled;
    }

    const inputWeight = document.getElementById('inputVacationWeight');
    const labelWeight = document.getElementById('labelVacationWeightVal');
    if (inputWeight && document.activeElement !== inputWeight) {
      inputWeight.value = state.vacationWeight;
      inputWeight.disabled = !state.holidaysEquivalenceEnabled;
    }
    if (labelWeight) {
      labelWeight.textContent = Number(state.vacationWeight).toFixed(1);
    }

    // 2. Gestión dinámica del equipo (1 a 6 miembros)
    const teamContainer = document.getElementById('teamMembersList');
    const teamBadge = document.getElementById('teamCountBadge');
    const btnAdd = document.getElementById('btnAddMember');

    if (teamBadge) {
      teamBadge.textContent = `${state.teamMembers.length} / 6 miembros`;
    }
    if (btnAdd) {
      btnAdd.disabled = state.teamMembers.length >= 6;
      btnAdd.title = state.teamMembers.length >= 6
        ? 'Límite máximo alcanzado (6 miembros)'
        : 'Añadir una nueva persona al equipo';
    }

    if (teamContainer) {
      const canDelete = state.teamMembers.length > 1;
      teamContainer.innerHTML = state.teamMembers.map((m, idx) => {
        const pal = AssignmentEngine.MEMBER_PALETTE[m.colorIndex % AssignmentEngine.MEMBER_PALETTE.length];
        const stats = metrics.memberStats.find(s => s.id === m.id);
        const initials = m.name ? m.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : `P${idx + 1}`;

        return `
          <div class="member-edit-card" style="border-left: 4px solid ${pal.color};">
            <div class="member-avatar" style="background-color: ${pal.color};" title="Color: ${pal.name}">
              ${initials}
            </div>
            <div style="flex: 1; display: flex; flex-direction: column; gap: 0.2rem; min-width: 0;">
              <input 
                type="text" 
                class="member-input-name" 
                data-member-id="${m.id}" 
                value="${m.name}" 
                placeholder="Nombre del miembro"
                maxlength="30"
                title="Editar nombre del miembro">
              <div style="font-size: 0.725rem; color: var(--text-muted); display: flex; gap: 0.6rem;">
                <span><strong>${stats ? stats.weeksCount : 0}</strong> sem.</span>
                <span><strong>${stats ? stats.festivosEquiv : 0}</strong> fest. eq.</span>
                <span class="col-mono">${stats ? currencyFormatter.format(stats.totalCost) : '0 €'}</span>
              </div>
            </div>
            <button 
              type="button" 
              class="btn-delete-member" 
              data-member-id="${m.id}" 
              title="${canDelete ? 'Eliminar ' + m.name + ' del equipo' : 'Mínimo 1 miembro en el equipo'}"
              ${!canDelete ? 'disabled' : ''}>
              🗑️
            </button>
          </div>
        `;
      }).join('');
    }

    // 3. Tarjetas KPI de dispersión y métricas globales
    const kpisContainer = document.getElementById('assignmentKpisGrid');
    if (kpisContainer) {
      let qualityBadge = '<span class="badge badge-success">⚖️ Reparto Equitativo</span>';
      let qualityDesc = 'La diferencia entre miembros es mínima.';

      if (state.assignmentStrategy === 'round_robin') {
        qualityBadge = '<span class="badge badge-warning">🔄 Diagnóstico Round-Robin</span>';
        qualityDesc = 'Asignación secuencial fija sin balancear.';
      } else if (state.assignmentStrategy === 'economic') {
        qualityBadge = disp.costRange < 50
          ? '<span class="badge badge-success">🛡️ Máxima Equidad Económica</span>'
          : '<span class="badge badge-primary">💰 Balance Económico</span>';
        qualityDesc = `Rango entre ingresos de sólo ${currencyFormatter.format(disp.costRange)}.`;
      } else if (state.assignmentStrategy === 'holidays') {
        qualityBadge = disp.holidaysRange <= 0.5
          ? '<span class="badge badge-success">🏖️ Festivos Perfectamente Balanceados</span>'
          : '<span class="badge badge-purple">🏖️ Equidad en Festivos</span>';
        qualityDesc = `Rango de festivos equivalentes: ${disp.holidaysRange.toFixed(1)}.`;
      } else if (state.assignmentStrategy === 'mixed') {
        qualityBadge = '<span class="badge badge-success">⚖️ Compromiso Multiobjetivo</span>';
        qualityDesc = 'Balance óptimo conjunto de ingresos y festivos.';
      }

      kpisContainer.innerHTML = `
        <div class="kpi-card">
          <div class="kpi-label">
            <span>Dispersión de Ingresos</span>
            <span class="badge badge-subtle">Δ Máx - Mín</span>
          </div>
          <div class="kpi-value ${disp.costRange > 500 ? 'text-danger' : 'text-success'}">
            ${currencyFormatter.format(disp.costRange)}
          </div>
          <div class="kpi-subtext">
            Desviación típica: <strong>σ = ${currencyFormatter.format(disp.costStdDev)}</strong>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">
            <span>Dispersión Festivos Eq.</span>
            <span class="badge badge-subtle">Δ Festivos</span>
          </div>
          <div class="kpi-value ${disp.holidaysRange > 3 ? 'text-danger' : 'text-success'}">
            ${disp.holidaysRange.toFixed(1)} fest.
          </div>
          <div class="kpi-subtext">
            Desviación típica: <strong>σ = ${disp.holidaysStdDev.toFixed(2)}</strong>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">
            <span>Medias por Miembro</span>
            <span class="badge badge-subtle">Promedio</span>
          </div>
          <div class="kpi-value">
            ${currencyFormatter.format(avg.cost)}
          </div>
          <div class="kpi-subtext">
            <strong>${avg.weeks.toFixed(1)} sem.</strong> y <strong>${avg.festivosEquiv.toFixed(1)} festivos eq.</strong>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">
            <span>Criterio y Balance</span>
            ${qualityBadge}
          </div>
          <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-top: 0.35rem; margin-bottom: 0.25rem;">
            ${selectStrategy ? selectStrategy.options[selectStrategy.selectedIndex].text.split('(')[0] : ''}
          </div>
          <div class="kpi-subtext">
            ${qualityDesc}
          </div>
        </div>
      `;
    }

    // 4. Tabla resumen anual por persona
    const tbodySummary = document.getElementById('teamSummaryTableBody');
    if (tbodySummary) {
      tbodySummary.innerHTML = metrics.memberStats.map(m => {
        const pal = m.palette;
        const initials = m.name ? m.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'P';
        const costPct = tot.cost > 0 ? (m.totalCost / tot.cost) * 100 : 0;

        // Formato delta €
        let deltaCostCls = 'delta-balanced';
        let deltaCostSign = '±';
        if (Math.abs(m.diffCostVsMean) >= 0.05) {
          if (m.diffCostVsMean > 0) {
            deltaCostCls = 'delta-positive';
            deltaCostSign = '+';
          } else {
            deltaCostCls = 'delta-negative';
            deltaCostSign = '';
          }
        }
        const deltaCostText = `${deltaCostSign}${currencyFormatter.format(m.diffCostVsMean)} (${m.diffCostPctVsMean >= 0 ? '+' : ''}${m.diffCostPctVsMean.toFixed(1)}%)`;

        // Formato delta festivos
        let deltaFestCls = 'delta-balanced';
        let deltaFestSign = '±';
        if (Math.abs(m.diffHolidaysVsMean) >= 0.05) {
          if (m.diffHolidaysVsMean > 0) {
            deltaFestCls = 'delta-fest-pos';
            deltaFestSign = '+';
          } else {
            deltaFestCls = 'delta-fest-neg';
            deltaFestSign = '';
          }
        }
        const deltaFestText = `${deltaFestSign}${m.diffHolidaysVsMean.toFixed(1)}`;

        return `
          <tr>
            <td>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="member-avatar" style="background-color: ${pal.color};">${initials}</span>
                <span style="font-weight: 700; color: var(--text-primary);">${m.name}</span>
              </div>
            </td>
            <td style="text-align: center;" class="col-mono">${m.weeksCount} sem.</td>
            <td style="text-align: center;" class="col-mono">${m.festivosPuros}</td>
            <td style="text-align: center;" class="col-mono">${m.festivosEquiv.toFixed(1)}</td>
            <td style="text-align: right; font-weight: 800;" class="col-mono">${currencyFormatter.format(m.totalCost)}</td>
            <td style="text-align: center;">
              <span class="delta-badge ${deltaCostCls}">${deltaCostText}</span>
            </td>
            <td style="text-align: center;">
              <span class="delta-badge ${deltaFestCls}">${deltaFestText}</span>
            </td>
            <td>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div class="member-progress-bar-track">
                  <div class="member-progress-bar-fill" style="width: ${costPct.toFixed(1)}%; background-color: ${pal.color};"></div>
                </div>
                <span class="col-mono" style="font-size: 0.775rem;">${costPct.toFixed(1)}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Actualizar pie de tabla resumen
      const elTotWeeks = document.getElementById('teamTotalWeeks');
      const elTotFestPuros = document.getElementById('teamTotalFestivosPuros');
      const elTotFestEq = document.getElementById('teamTotalFestivosEquiv');
      const elTotCost = document.getElementById('teamTotalCost');

      const elAvgWeeks = document.getElementById('teamAvgWeeks');
      const elAvgFestPuros = document.getElementById('teamAvgFestivosPuros');
      const elAvgFestEq = document.getElementById('teamAvgFestivosEquiv');
      const elAvgCost = document.getElementById('teamAvgCost');

      if (elTotWeeks) elTotWeeks.textContent = tot.weeks;
      if (elTotFestPuros) elTotFestPuros.textContent = tot.festivosPuros;
      if (elTotFestEq) elTotFestEq.textContent = tot.festivosEquiv.toFixed(1);
      if (elTotCost) elTotCost.textContent = currencyFormatter.format(tot.cost);

      if (elAvgWeeks) elAvgWeeks.textContent = avg.weeks.toFixed(2);
      if (elAvgFestPuros) elAvgFestPuros.textContent = avg.festivosPuros.toFixed(2);
      if (elAvgFestEq) elAvgFestEq.textContent = avg.festivosEquiv.toFixed(2);
      if (elAvgCost) elAvgCost.textContent = currencyFormatter.format(avg.cost);
    }

    // 5. Cronograma detallado de semanas con reasignación interactiva
    const tbodyTimeline = document.getElementById('assignmentTimelineBody');
    if (tbodyTimeline) {
      const rates = state.calcResult.precios;
      const weeksData = AssignmentEngine.prepareWeeksData(
        state.calendar.weeksList,
        rates,
        {
          vacationWeight: state.vacationWeight,
          holidaysEquivalenceEnabled: state.holidaysEquivalenceEnabled
        }
      );

      tbodyTimeline.innerHTML = weeksData.map(w => {
        const assignedId = state.assignments ? state.assignments[w.weekKey] : null;
        const currentMember = state.teamMembers.find(m => m.id === assignedId);
        const pal = currentMember
          ? AssignmentEngine.MEMBER_PALETTE[currentMember.colorIndex % AssignmentEngine.MEMBER_PALETTE.length]
          : null;

        const dStart = new Date(w.startDate + 'T00:00:00Z');
        const dEnd = new Date(w.endDate + 'T00:00:00Z');
        const optFormat = { day: '2-digit', month: '2-digit' };
        const rangeStr = `${dStart.toLocaleDateString('es-ES', optFormat)} - ${dEnd.toLocaleDateString('es-ES', optFormat)}`;

        const optionsHtml = state.teamMembers.map(m => {
          return `<option value="${m.id}" ${m.id === assignedId ? 'selected' : ''}>${m.name}</option>`;
        }).join('');

        return `
          <tr data-week-key="${w.weekKey}">
            <td class="col-mono">W${String(w.weekNum).padStart(2, '0')}</td>
            <td>${rangeStr}</td>
            <td><span class="badge ${w.counts.festivo > 0 ? 'badge-purple' : (w.counts.cierre > 0 ? 'badge-amber' : 'badge-blue')}">${w.archetype}</span></td>
            <td>
              <span class="badge badge-normal">${w.counts.normal}N</span>
              ${w.counts.cierre > 0 ? `<span class="badge badge-cierre">${w.counts.cierre}C</span>` : ''}
              ${w.counts.festivo > 0 ? `<span class="badge badge-festivo">${w.counts.festivo}F</span>` : ''}
            </td>
            <td class="col-mono" style="font-weight: 700;">${w.festivosEquivalentes.toFixed(1)}</td>
            <td class="col-mono" style="font-weight: 800;">${currencyFormatter.format(w.cost)}</td>
            <td>
              <select 
                class="assignee-select-cell timeline-assignee-select" 
                data-week-key="${w.weekKey}"
                style="${pal ? 'border-left: 3px solid ' + pal.color + ';' : ''}"
                title="Cambiar responsable asignado">
                ${optionsHtml}
              </select>
            </td>
          </tr>
        `;
      }).join('');
    }
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

    // 17. MÓDULO DE ASIGNACIÓN: Selección de estrategia
    const selectAssignmentStrategy = document.getElementById('selectAssignmentStrategy');
    if (selectAssignmentStrategy) {
      selectAssignmentStrategy.addEventListener('change', (e) => {
        state.assignmentStrategy = e.target.value;
        recalculate(true);
      });
    }

    const btnRunAutoAssign = document.getElementById('btnRunAutoAssign');
    if (btnRunAutoAssign) {
      btnRunAutoAssign.addEventListener('click', () => {
        recalculate(true);
      });
    }

    // 18. MÓDULO DE ASIGNACIÓN: Equivalencia de vacaciones como festivo
    const toggleHolidayEquivalence = document.getElementById('toggleHolidayEquivalence');
    const inputVacationWeight = document.getElementById('inputVacationWeight');
    const labelVacationWeightVal = document.getElementById('labelVacationWeightVal');

    if (toggleHolidayEquivalence) {
      toggleHolidayEquivalence.addEventListener('change', (e) => {
        state.holidaysEquivalenceEnabled = e.target.checked;
        if (inputVacationWeight) inputVacationWeight.disabled = !e.target.checked;
        recalculate(true);
      });
    }

    if (inputVacationWeight) {
      inputVacationWeight.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 0) {
          state.vacationWeight = val;
          if (labelVacationWeightVal) labelVacationWeightVal.textContent = val.toFixed(1);
          recalculate(true);
        }
      });
    }

    // 19. MÓDULO DE ASIGNACIÓN: Gestión dinámica del equipo (añadir, editar, borrar)
    const btnAddMember = document.getElementById('btnAddMember');
    if (btnAddMember) {
      btnAddMember.addEventListener('click', () => {
        if (state.teamMembers.length >= 6) return;
        const count = state.teamMembers.length;
        const nextColorIdx = count % AssignmentEngine.MEMBER_PALETTE.length;
        const newMember = {
          id: AssignmentEngine.generateMemberId(),
          name: `Persona ${count + 1}`,
          colorIndex: nextColorIdx
        };
        state.teamMembers.push(newMember);
        recalculate(true);
      });
    }

    const teamContainer = document.getElementById('teamMembersList');
    if (teamContainer) {
      // Editar nombre en tiempo real
      teamContainer.addEventListener('input', (e) => {
        const input = e.target.closest('.member-input-name');
        if (input) {
          const mId = input.getAttribute('data-member-id');
          const member = state.teamMembers.find(m => m.id === mId);
          if (member) {
            member.name = input.value.trim() || 'Sin nombre';
            refreshMemberNamesOnly();
          }
        }
      });

      // Refresco completo al salir del input
      teamContainer.addEventListener('change', (e) => {
        const input = e.target.closest('.member-input-name');
        if (input) {
          refreshAfterManualAssignment();
        }
      });

      // Eliminar persona
      teamContainer.addEventListener('click', (e) => {
        const btnDelete = e.target.closest('.btn-delete-member');
        if (btnDelete) {
          const mId = btnDelete.getAttribute('data-member-id');
          if (state.teamMembers.length <= 1) {
            alert('El equipo debe contar con al menos 1 miembro.');
            return;
          }
          const memberToDelete = state.teamMembers.find(m => m.id === mId);
          const name = memberToDelete ? memberToDelete.name : 'este miembro';
          if (confirm(`¿Eliminar a ${name} del equipo de guardia? Sus semanas se reasignarán automáticamente.`)) {
            state.teamMembers = state.teamMembers.filter(m => m.id !== mId);
            recalculate(true);
          }
        }
      });
    }

    // 20. MÓDULO DE ASIGNACIÓN: Reasignación interactiva desde el Inspector
    const inspectorSelect = document.getElementById('inspectorAssigneeSelect');
    if (inspectorSelect) {
      inspectorSelect.addEventListener('change', (e) => {
        const newMemberId = e.target.value;
        if (state.selectedWeekKey && state.assignments) {
          state.assignments[state.selectedWeekKey] = newMemberId;
          refreshAfterManualAssignment();
        }
      });
    }

    // 21. MÓDULO DE ASIGNACIÓN: Reasignación interactiva desde la Tabla de Semanas
    const weeksTableBody = document.getElementById('weeksTableBody');
    if (weeksTableBody) {
      weeksTableBody.addEventListener('change', (e) => {
        const select = e.target.closest('.week-table-assignee-select');
        if (select) {
          const weekKey = select.getAttribute('data-week-key');
          const newMemberId = select.value;
          if (weekKey && state.assignments) {
            state.assignments[weekKey] = newMemberId;
            refreshAfterManualAssignment();
          }
        }
      });
    }

    // 22. MÓDULO DE ASIGNACIÓN: Reasignación interactiva desde el Cronograma
    const timelineBody = document.getElementById('assignmentTimelineBody');
    if (timelineBody) {
      timelineBody.addEventListener('change', (e) => {
        const select = e.target.closest('.timeline-assignee-select');
        if (select) {
          const weekKey = select.getAttribute('data-week-key');
          const newMemberId = select.value;
          if (weekKey && state.assignments) {
            state.assignments[weekKey] = newMemberId;
            refreshAfterManualAssignment();
          }
        }
      });
    }
  }

  /**
   * Refresca sólo los nombres de miembros en selects y etiquetas sin tocar los inputs de texto
   */
  function refreshMemberNamesOnly() {
    renderCalendarGrid();
    renderWeekInspector();
    renderWeeksTable();
    // Actualizar tabla resumen
    if (typeof AssignmentEngine !== 'undefined') {
      const weeksData = AssignmentEngine.prepareWeeksData(
        state.calendar.weeksList,
        state.calcResult.precios,
        {
          vacationWeight: state.vacationWeight,
          holidaysEquivalenceEnabled: state.holidaysEquivalenceEnabled
        }
      );
      state.teamMetrics = AssignmentEngine.calculateTeamMetrics(
        weeksData,
        state.assignments,
        state.teamMembers
      );
      const tbodySummary = document.getElementById('teamSummaryTableBody');
      if (tbodySummary) {
        tbodySummary.innerHTML = state.teamMetrics.memberStats.map(m => {
          const pal = m.palette;
          const initials = m.name ? m.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'P';
          const costPct = state.teamMetrics.totals.cost > 0 ? (m.totalCost / state.teamMetrics.totals.cost) * 100 : 0;
          let deltaCostCls = 'delta-balanced';
          let deltaCostSign = '±';
          if (Math.abs(m.diffCostVsMean) >= 0.05) {
            deltaCostCls = m.diffCostVsMean > 0 ? 'delta-positive' : 'delta-negative';
            deltaCostSign = m.diffCostVsMean > 0 ? '+' : '';
          }
          const deltaCostText = `${deltaCostSign}${currencyFormatter.format(m.diffCostVsMean)} (${m.diffCostPctVsMean >= 0 ? '+' : ''}${m.diffCostPctVsMean.toFixed(1)}%)`;
          let deltaFestCls = 'delta-balanced';
          let deltaFestSign = '±';
          if (Math.abs(m.diffHolidaysVsMean) >= 0.05) {
            deltaFestCls = m.diffHolidaysVsMean > 0 ? 'delta-fest-pos' : 'delta-fest-neg';
            deltaFestSign = m.diffHolidaysVsMean > 0 ? '+' : '';
          }
          const deltaFestText = `${deltaFestSign}${m.diffHolidaysVsMean.toFixed(1)}`;
          return `
            <tr>
              <td>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <span class="member-avatar" style="background-color: ${pal.color};">${initials}</span>
                  <span style="font-weight: 700; color: var(--text-primary);">${m.name}</span>
                </div>
              </td>
              <td style="text-align: center;" class="col-mono">${m.weeksCount} sem.</td>
              <td style="text-align: center;" class="col-mono">${m.festivosPuros}</td>
              <td style="text-align: center;" class="col-mono">${m.festivosEquiv.toFixed(1)}</td>
              <td style="text-align: right; font-weight: 800;" class="col-mono">${currencyFormatter.format(m.totalCost)}</td>
              <td style="text-align: center;"><span class="delta-badge ${deltaCostCls}">${deltaCostText}</span></td>
              <td style="text-align: center;"><span class="delta-badge ${deltaFestCls}">${deltaFestText}</span></td>
              <td>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <div class="member-progress-bar-track">
                    <div class="member-progress-bar-fill" style="width: ${costPct.toFixed(1)}%; background-color: ${pal.color};"></div>
                  </div>
                  <span class="col-mono" style="font-size: 0.775rem;">${costPct.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  /**
   * Refresca las métricas tras una reasignación manual
   */
  function refreshAfterManualAssignment() {
    if (typeof AssignmentEngine === 'undefined' || !state.calendar) return;

    const weeksData = AssignmentEngine.prepareWeeksData(
      state.calendar.weeksList,
      state.calcResult.precios,
      {
        vacationWeight: state.vacationWeight,
        holidaysEquivalenceEnabled: state.holidaysEquivalenceEnabled
      }
    );

    state.teamMetrics = AssignmentEngine.calculateTeamMetrics(
      weeksData,
      state.assignments,
      state.teamMembers
    );

    renderCalendarGrid();
    renderWeekInspector();
    renderWeeksTable();
    renderTeamAssignmentTab();
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
        recalculate(true);
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
    if (confirm('¿Restablecer el presupuesto, ponderaciones y equipo de guardia por defecto?')) {
      state.presupuestoSemanal = 600.0;
      state.semanasAnio = 52;
      state.presupuestoAnual = 31200.0;
      state.strictCeiling = true;
      state.weights = { normal: 1.0, cierre: 1.3, festivo: 1.8 };
      state.selectedWeekKey = '2026-W14';

      if (typeof AssignmentEngine !== 'undefined') {
        state.teamMembers = JSON.parse(JSON.stringify(AssignmentEngine.DEFAULT_MEMBERS));
      }
      state.assignmentStrategy = 'economic';
      state.holidaysEquivalenceEnabled = true;
      state.vacationWeight = 0.5;
      state.assignments = {};

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

      recalculate(true);
    }
  }

  /**
   * Exporta el desglose completo de las 53 semanas y reparto del equipo a CSV para Excel / Nóminas
   */
  function exportCsv() {
    const rates = state.calcResult.precios;
    const weeks = state.calendar.weeksList;

    let csv = '\uFEFF'; // BOM para compatibilidad UTF-8 en Excel
    csv += 'CompensaGuardias - Presupuesto Anual y Reparto del Equipo de Guardias\n';
    csv += `Año:;${state.calendar.year};Presupuesto Anual Límite:;${state.presupuestoAnual.toFixed(2)} €\n`;
    csv += `Criterio de Reparto:;${state.assignmentStrategy};Vacaciones como Festivo:;${state.holidaysEquivalenceEnabled ? 'Sí (peso ' + state.vacationWeight + ')' : 'No'}\n`;
    csv += `Tarifa Normal (€):;${rates.normal.toFixed(2)};Tarifa Cierre (€):;${rates.cierre.toFixed(2)};Tarifa Festivo (€):;${rates.festivo.toFixed(2)}\n\n`;

    // 1. Desglose semanal
    csv += 'Semana;Fecha Inicio;Fecha Fin;Arquetipo;Dias Normales;Dias Cierre;Dias Festivo;Festivos Equiv;Total Semana (€);Responsable Asignado\n';

    weeks.forEach(w => {
      const costObj = Calculator.calculateWeekCost(w.daysInBudgetYear, rates);
      const assignedId = state.assignments ? state.assignments[w.weekKey] : '';
      const member = state.teamMembers.find(m => m.id === assignedId);
      const memberName = member ? member.name : 'Sin asignar';
      const festEquiv = AssignmentEngine.calculateEquivalentHolidays(
        w.counts.festivo,
        w.counts.cierre,
        state.vacationWeight,
        state.holidaysEquivalenceEnabled
      );

      csv += `${w.weekKey};${w.startDate};${w.endDate};"${w.archetype}";${w.counts.normal};${w.counts.cierre};${w.counts.festivo};${festEquiv.toFixed(1)};${costObj.total.toFixed(2)};"${memberName}"\n`;
    });

    // 2. Resumen por persona
    if (state.teamMetrics && state.teamMetrics.memberStats) {
      csv += '\n\nResumen Anual por Miembro del Equipo:\n';
      csv += 'Miembro;Semanas Asignadas;Festivos Puros;Festivos Equivalentes;Total Acumulado (€);Desviacion vs Media (€);Desviacion Festivos vs Media\n';

      state.teamMetrics.memberStats.forEach(m => {
        csv += `"${m.name}";${m.weeksCount};${m.festivosPuros};${m.festivosEquiv.toFixed(1)};${m.totalCost.toFixed(2)};${m.diffCostVsMean.toFixed(2)};${m.diffHolidaysVsMean.toFixed(1)}\n`;
      });

      const avg = state.teamMetrics.averages;
      csv += `"MEDIA EQUIPO";${avg.weeks.toFixed(2)};${avg.festivosPuros.toFixed(2)};${avg.festivosEquiv.toFixed(2)};${avg.cost.toFixed(2)};0.00;0.0\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `guardias-reparto-${state.calendar.year}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Exporta la configuración, cálculo y reparto de equipo a JSON
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
      teamAssignment: {
        strategy: state.assignmentStrategy,
        holidaysEquivalenceEnabled: state.holidaysEquivalenceEnabled,
        vacationWeight: state.vacationWeight,
        teamMembers: state.teamMembers,
        assignments: state.assignments,
        teamMetrics: state.teamMetrics
      },
      weeksSummary: state.calendar.weeksList.map(w => {
        const cost = Calculator.calculateWeekCost(w.daysInBudgetYear, state.calcResult.precios);
        const assignedId = state.assignments ? state.assignments[w.weekKey] : null;
        const member = state.teamMembers.find(m => m.id === assignedId);
        return {
          weekKey: w.weekKey,
          startDate: w.startDate,
          endDate: w.endDate,
          archetype: w.archetype,
          counts: w.counts,
          totalCost: cost.total,
          assignedTo: member ? { id: member.id, name: member.name } : null
        };
      })
    };

    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `compensaguardias-reparto-${state.calendar.year}.json`);
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
