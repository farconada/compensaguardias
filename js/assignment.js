/**
 * CompensaGuardias - Motor de Asignación y Reparto de Guardias
 * Módulo desacoplado para gestión de equipos, asignación semanal de guardias y algoritmos de optimización.
 */

(function (global) {
  'use strict';

  // Paleta predefinida y distintiva para hasta 6 miembros (accesible en temas claro y oscuro)
  const MEMBER_PALETTE = [
    { id: 'col1', name: 'Azul', color: '#2563eb', bg: '#eff6ff', border: '#93c5fd', textDark: '#1e40af' },
    { id: 'col2', name: 'Esmeralda', color: '#059669', bg: '#ecfdf5', border: '#6ee7b7', textDark: '#065f46' },
    { id: 'col3', name: 'Ámbar', color: '#d97706', bg: '#fffbeb', border: '#fcd34d', textDark: '#92400e' },
    { id: 'col4', name: 'Púrpura', color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd', textDark: '#5b21b6' },
    { id: 'col5', name: 'Rosa', color: '#db2777', bg: '#fdf2f8', border: '#fbcfe8', textDark: '#9d174d' },
    { id: 'col6', name: 'Cian', color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc', textDark: '#155e75' }
  ];

  const DEFAULT_MEMBERS = [
    { id: 'm1', name: 'Carlos Santana', colorIndex: 0 },
    { id: 'm2', name: 'Lucía Méndez', colorIndex: 1 },
    { id: 'm3', name: 'David Romero', colorIndex: 2 },
    { id: 'm4', name: 'Elena Navarro', colorIndex: 3 }
  ];

  /**
   * Genera un identificador único para nuevos miembros
   */
  function generateMemberId() {
    return 'm_' + Math.random().toString(36).substring(2, 9);
  }

  /**
   * Redondeo numérico seguro
   */
  function round(val, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round((val + Number.EPSILON) * factor) / factor;
  }

  /**
   * Calcula los festivos equivalentes de una semana
   * Fórmula: Festivos equivalentes = Festivos + (Cierres * peso_vacaciones)
   */
  function calculateEquivalentHolidays(festivoCount, cierreCount, vacationWeight = 0.5, enabled = true) {
    const festivos = Number(festivoCount) || 0;
    const cierres = Number(cierreCount) || 0;
    if (!enabled) {
      return festivos;
    }
    const weight = Math.max(0, Number(vacationWeight) || 0);
    return round(festivos + (cierres * weight), 3);
  }

  /**
   * Prepara la lista de datos procesados de cada semana para los algoritmos
   */
  function prepareWeeksData(weeksList, rates, options = {}) {
    const { vacationWeight = 0.5, holidaysEquivalenceEnabled = true } = options;

    return weeksList.map((w, index) => {
      // Coste usando Calculator si está disponible o cálculo directo
      let cost = 0;
      if (global.Calculator && typeof global.Calculator.calculateWeekCost === 'function') {
        cost = global.Calculator.calculateWeekCost(w.daysInBudgetYear, rates).total;
      } else {
        const nNorm = w.counts.normal || 0;
        const nCier = w.counts.cierre || 0;
        const nFest = w.counts.festivo || 0;
        cost = round((nNorm * (rates.normal || 0)) + (nCier * (rates.cierre || 0)) + (nFest * (rates.festivo || 0)), 2);
      }

      const festivosPuros = w.counts.festivo || 0;
      const cierres = w.counts.cierre || 0;
      const festivosEquivalentes = calculateEquivalentHolidays(
        festivosPuros,
        cierres,
        vacationWeight,
        holidaysEquivalenceEnabled
      );

      return {
        weekKey: w.weekKey,
        weekNum: w.weekNum,
        startDate: w.startDate,
        endDate: w.endDate,
        archetype: w.archetype,
        counts: { ...w.counts },
        cost,
        festivosPuros,
        cierres,
        festivosEquivalentes,
        chronoIndex: index
      };
    });
  }

  /**
   * 1. Turno Rotativo Estricto (Round-Robin)
   * Asignación secuencial fija (Persona 1 -> Persona 2 -> ... -> Persona N -> repetir)
   */
  function assignRoundRobin(weeksData, members) {
    const assignments = {};
    if (!members || members.length === 0) return assignments;

    const numMembers = members.length;
    // Las semanas se asignan en orden cronológico estricto
    const sortedWeeks = [...weeksData].sort((a, b) => a.chronoIndex - b.chronoIndex);

    sortedWeeks.forEach((w, idx) => {
      const member = members[idx % numMembers];
      assignments[w.weekKey] = member.id;
    });

    return assignments;
  }

  /**
   * Determina los miembros elegibles para recibir una semana garantizando
   * que el número final de semanas asignadas difiera a lo sumo en 1 semana entre miembros
   * (cada miembro tendrá estrictamente floor(M/N) o ceil(M/N) semanas).
   */
  function getEligibleMembers(members, memberStats, M, N) {
    const baseQuota = Math.floor(M / N);
    const extraSlots = M % N;

    let membersWithExtra = 0;
    for (const m of members) {
      if (memberStats.get(m.id).weekCount > baseQuota) {
        membersWithExtra++;
      }
    }

    const eligible = members.filter(m => {
      const count = memberStats.get(m.id).weekCount;
      if (count > baseQuota) return false;
      if (count === baseQuota && membersWithExtra >= extraSlots) return false;
      return true;
    });

    return eligible.length > 0 ? eligible : members;
  }

  /**
   * 2. Equidad Económica (Económico Balanceado)
   * Minimiza la varianza y la diferencia en el importe total cobrado a final de año.
   * Mantiene el número de semanas por persona equilibrado (diferencia máxima de 1 semana).
   */
  function assignEconomicBalanced(weeksData, members) {
    const assignments = {};
    if (!members || members.length === 0) return assignments;
    if (members.length === 1) {
      weeksData.forEach(w => { assignments[w.weekKey] = members[0].id; });
      return assignments;
    }

    const N = members.length;
    const M = weeksData.length;

    // Estado acumulado por miembro
    const memberStats = new Map();
    members.forEach(m => {
      memberStats.set(m.id, {
        member: m,
        totalCost: 0,
        weekCount: 0,
        weeks: []
      });
    });

    // Ordenar semanas de mayor a menor coste (Heurística Karmarkar-Karp / LPT)
    const sortedWeeks = [...weeksData].sort((a, b) => b.cost - a.cost || a.chronoIndex - b.chronoIndex);

    // Paso 1: Greedy balanceado con restricción estricta de cuota de semanas
    sortedWeeks.forEach(w => {
      const eligible = getEligibleMembers(members, memberStats, M, N);

      // Entre los elegibles, buscar quien tenga menor coste total
      // Romper empates con menor weekCount
      eligible.sort((a, b) => {
        const statsA = memberStats.get(a.id);
        const statsB = memberStats.get(b.id);
        if (Math.abs(statsA.totalCost - statsB.totalCost) > 0.001) {
          return statsA.totalCost - statsB.totalCost;
        }
        return statsA.weekCount - statsB.weekCount;
      });

      const chosen = eligible[0];
      const stats = memberStats.get(chosen.id);
      stats.totalCost += w.cost;
      stats.weekCount += 1;
      stats.weeks.push(w);
      assignments[w.weekKey] = chosen.id;
    });

    // Paso 2: Optimización Local (2-opt swaps) para minimizar la dispersión de euros
    // Intercambiar pares de semanas entre dos personas si reduce la varianza o max - min de euros
    let improved = true;
    let iterations = 0;
    const maxIterations = 200;

    function evaluateVariance(statsMap) {
      const costs = Array.from(statsMap.values()).map(s => s.totalCost);
      const mean = costs.reduce((acc, v) => acc + v, 0) / costs.length;
      return costs.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0);
    }

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      const currentVariance = evaluateVariance(memberStats);
      const memberList = Array.from(memberStats.values());

      for (let i = 0; i < memberList.length; i++) {
        for (let j = i + 1; j < memberList.length; j++) {
          const m1 = memberList[i];
          const m2 = memberList[j];

          // Intentar intercambiar una semana de m1 con una semana de m2
          for (let wi = 0; wi < m1.weeks.length; wi++) {
            for (let wj = 0; wj < m2.weeks.length; wj++) {
              const week1 = m1.weeks[wi];
              const week2 = m2.weeks[wj];

              const diff = week1.cost - week2.cost;
              if (Math.abs(diff) < 0.01) continue;

              // Nuevo total tras el swap
              const newCost1 = m1.totalCost - diff;
              const newCost2 = m2.totalCost + diff;

              // Evaluar si reduce la varianza
              const mean = (m1.totalCost + m2.totalCost) / 2;
              const oldDev = Math.pow(m1.totalCost - mean, 2) + Math.pow(m2.totalCost - mean, 2);
              const newDev = Math.pow(newCost1 - mean, 2) + Math.pow(newCost2 - mean, 2);

              if (newDev < oldDev - 0.01) {
                // Aplicar el swap
                m1.weeks[wi] = week2;
                m2.weeks[wj] = week1;
                m1.totalCost = newCost1;
                m2.totalCost = newCost2;
                assignments[week1.weekKey] = m2.member.id;
                assignments[week2.weekKey] = m1.member.id;
                improved = true;
                break;
              }
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (improved) break;
      }
    }

    return assignments;
  }

  /**
   * 3. Equidad en Festivos (Festivos Balanceados)
   * Minimiza la disparidad en festivos equivalentes, manteniendo un control
   * secundario para equilibrar ingresos económicos.
   */
  function assignHolidaysBalanced(weeksData, members) {
    const assignments = {};
    if (!members || members.length === 0) return assignments;
    if (members.length === 1) {
      weeksData.forEach(w => { assignments[w.weekKey] = members[0].id; });
      return assignments;
    }

    const N = members.length;
    const M = weeksData.length;
    const maxWeeksPerMember = Math.ceil(M / N);

    const memberStats = new Map();
    members.forEach(m => {
      memberStats.set(m.id, {
        member: m,
        festivosEquiv: 0,
        totalCost: 0,
        weekCount: 0,
        weeks: []
      });
    });

    // Ordenar semanas por festivos equivalentes decreciente;
    // Si empatan, por coste decreciente
    const sortedWeeks = [...weeksData].sort((a, b) => {
      if (Math.abs(b.festivosEquivalentes - a.festivosEquivalentes) > 0.001) {
        return b.festivosEquivalentes - a.festivosEquivalentes;
      }
      return b.cost - a.cost || a.chronoIndex - b.chronoIndex;
    });

    // Asignación greedy con control primario en festivos y secundario en dinero
    sortedWeeks.forEach(w => {
      const eligible = getEligibleMembers(members, memberStats, M, N);

      eligible.sort((a, b) => {
        const statsA = memberStats.get(a.id);
        const statsB = memberStats.get(b.id);

        // Control primario: Festivos equivalentes
        if (Math.abs(statsA.festivosEquiv - statsB.festivosEquiv) > 0.001) {
          return statsA.festivosEquiv - statsB.festivosEquiv;
        }

        // Control secundario: Importe económico acumulado
        if (Math.abs(statsA.totalCost - statsB.totalCost) > 0.001) {
          return statsA.totalCost - statsB.totalCost;
        }

        return statsA.weekCount - statsB.weekCount;
      });

      const chosen = eligible[0];
      const stats = memberStats.get(chosen.id);
      stats.festivosEquiv = round(stats.festivosEquiv + w.festivosEquivalentes, 3);
      stats.totalCost = round(stats.totalCost + w.cost, 2);
      stats.weekCount += 1;
      stats.weeks.push(w);
      assignments[w.weekKey] = chosen.id;
    });

    // Optimización local de swaps:
    // Mejora festivos equivalentes en primer término, y secundariamente varianza económica
    let improved = true;
    let iterations = 0;
    const maxIterations = 200;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      const memberList = Array.from(memberStats.values());

      for (let i = 0; i < memberList.length; i++) {
        for (let j = i + 1; j < memberList.length; j++) {
          const m1 = memberList[i];
          const m2 = memberList[j];

          for (let wi = 0; wi < m1.weeks.length; wi++) {
            for (let wj = 0; wj < m2.weeks.length; wj++) {
              const week1 = m1.weeks[wi];
              const week2 = m2.weeks[wj];

              const diffHolidays = week1.festivosEquivalentes - week2.festivosEquivalentes;
              const diffCost = week1.cost - week2.cost;

              if (Math.abs(diffHolidays) < 0.001 && Math.abs(diffCost) < 0.01) continue;

              const meanHolidays = (m1.festivosEquiv + m2.festivosEquiv) / 2;
              const oldHDev = Math.pow(m1.festivosEquiv - meanHolidays, 2) + Math.pow(m2.festivosEquiv - meanHolidays, 2);
              const newH1 = m1.festivosEquiv - diffHolidays;
              const newH2 = m2.festivosEquiv + diffHolidays;
              const newHDev = Math.pow(newH1 - meanHolidays, 2) + Math.pow(newH2 - meanHolidays, 2);

              let shouldSwap = false;

              // Si reduce la varianza de festivos
              if (newHDev < oldHDev - 0.001) {
                shouldSwap = true;
              } else if (Math.abs(newHDev - oldHDev) < 0.001) {
                // Si mantiene exactamente igual los festivos, evaluar si mejora la dispersión de euros
                const meanCost = (m1.totalCost + m2.totalCost) / 2;
                const oldCDev = Math.pow(m1.totalCost - meanCost, 2) + Math.pow(m2.totalCost - meanCost, 2);
                const newC1 = m1.totalCost - diffCost;
                const newC2 = m2.totalCost + diffCost;
                const newCDev = Math.pow(newC1 - meanCost, 2) + Math.pow(newC2 - meanCost, 2);

                if (newCDev < oldCDev - 0.01) {
                  shouldSwap = true;
                }
              }

              if (shouldSwap) {
                m1.weeks[wi] = week2;
                m2.weeks[wj] = week1;
                m1.festivosEquiv = round(m1.festivosEquiv - diffHolidays, 3);
                m2.festivosEquiv = round(m2.festivosEquiv + diffHolidays, 3);
                m1.totalCost = round(m1.totalCost - diffCost, 2);
                m2.totalCost = round(m2.totalCost + diffCost, 2);
                assignments[week1.weekKey] = m2.member.id;
                assignments[week2.weekKey] = m1.member.id;
                improved = true;
                break;
              }
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (improved) break;
      }
    }

    return assignments;
  }

  /**
   * 4. Equilibrio Mixto (Ponderado: Ingresos + Festivos)
   * Algoritmo multiobjetivo que busca el balance óptimo conjunto entre la
   * remuneración económica total y la carga de festivos equivalentes.
   */
  function assignMixedBalanced(weeksData, members) {
    const assignments = {};
    if (!members || members.length === 0) return assignments;
    if (members.length === 1) {
      weeksData.forEach(w => { assignments[w.weekKey] = members[0].id; });
      return assignments;
    }

    const N = members.length;
    const M = weeksData.length;
    const maxWeeksPerMember = Math.ceil(M / N);

    const totalCostAll = weeksData.reduce((acc, w) => acc + w.cost, 0);
    const totalHolidaysAll = weeksData.reduce((acc, w) => acc + w.festivosEquivalentes, 0);

    const targetCostPerMember = totalCostAll / N;
    const targetHolidaysPerMember = totalHolidaysAll / N;

    const memberStats = new Map();
    members.forEach(m => {
      memberStats.set(m.id, {
        member: m,
        festivosEquiv: 0,
        totalCost: 0,
        weekCount: 0,
        weeks: []
      });
    });

    // Función de penalización multiobjetivo normalizada (Error cuadrático ponderado)
    function computeMemberPenalty(cost, holidays) {
      const normCostDiff = targetCostPerMember > 0 ? (cost - targetCostPerMember) / targetCostPerMember : 0;
      const normHolDiff = targetHolidaysPerMember > 0 ? (holidays - targetHolidaysPerMember) / targetHolidaysPerMember : 0;
      // Ponderación balanceada 50% euros + 50% festivos
      return 0.5 * Math.pow(normCostDiff, 2) + 0.5 * Math.pow(normHolDiff, 2);
    }

    // Ordenar semanas por una métrica combinada de importancia relativa
    const sortedWeeks = [...weeksData].sort((a, b) => {
      const scoreA = (a.cost / (targetCostPerMember || 1)) + (a.festivosEquivalentes / (targetHolidaysPerMember || 1));
      const scoreB = (b.cost / (targetCostPerMember || 1)) + (b.festivosEquivalentes / (targetHolidaysPerMember || 1));
      return scoreB - scoreA || a.chronoIndex - b.chronoIndex;
    });

    // Paso 1: Asignación greedy minimizando incremento de penalización global
    sortedWeeks.forEach(w => {
      const eligible = getEligibleMembers(members, memberStats, M, N);

      eligible.sort((a, b) => {
        const statsA = memberStats.get(a.id);
        const statsB = memberStats.get(b.id);

        const currentPenA = computeMemberPenalty(statsA.totalCost, statsA.festivosEquiv);
        const nextPenA = computeMemberPenalty(statsA.totalCost + w.cost, statsA.festivosEquiv + w.festivosEquivalentes);
        const deltaA = nextPenA - currentPenA;

        const currentPenB = computeMemberPenalty(statsB.totalCost, statsB.festivosEquiv);
        const nextPenB = computeMemberPenalty(statsB.totalCost + w.cost, statsB.festivosEquiv + w.festivosEquivalentes);
        const deltaB = nextPenB - currentPenB;

        if (Math.abs(deltaA - deltaB) > 0.0001) {
          return deltaA - deltaB;
        }
        return statsA.weekCount - statsB.weekCount;
      });

      const chosen = eligible[0];
      const stats = memberStats.get(chosen.id);
      stats.festivosEquiv = round(stats.festivosEquiv + w.festivosEquivalentes, 3);
      stats.totalCost = round(stats.totalCost + w.cost, 2);
      stats.weekCount += 1;
      stats.weeks.push(w);
      assignments[w.weekKey] = chosen.id;
    });

    // Paso 2: Optimización local de swaps multiobjetivo
    let improved = true;
    let iterations = 0;
    const maxIterations = 200;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      const memberList = Array.from(memberStats.values());

      for (let i = 0; i < memberList.length; i++) {
        for (let j = i + 1; j < memberList.length; j++) {
          const m1 = memberList[i];
          const m2 = memberList[j];

          const currentPenPair = computeMemberPenalty(m1.totalCost, m1.festivosEquiv) +
                                 computeMemberPenalty(m2.totalCost, m2.festivosEquiv);

          for (let wi = 0; wi < m1.weeks.length; wi++) {
            for (let wj = 0; wj < m2.weeks.length; wj++) {
              const week1 = m1.weeks[wi];
              const week2 = m2.weeks[wj];

              const diffHolidays = week1.festivosEquivalentes - week2.festivosEquivalentes;
              const diffCost = week1.cost - week2.cost;

              const candidateCost1 = m1.totalCost - diffCost;
              const candidateHol1 = m1.festivosEquiv - diffHolidays;

              const candidateCost2 = m2.totalCost + diffCost;
              const candidateHol2 = m2.festivosEquiv + diffHolidays;

              const newPenPair = computeMemberPenalty(candidateCost1, candidateHol1) +
                                 computeMemberPenalty(candidateCost2, candidateHol2);

              if (newPenPair < currentPenPair - 0.0001) {
                m1.weeks[wi] = week2;
                m2.weeks[wj] = week1;
                m1.festivosEquiv = round(candidateHol1, 3);
                m2.festivosEquiv = round(candidateHol2, 3);
                m1.totalCost = round(candidateCost1, 2);
                m2.totalCost = round(candidateCost2, 2);
                assignments[week1.weekKey] = m2.member.id;
                assignments[week2.weekKey] = m1.member.id;
                improved = true;
                break;
              }
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (improved) break;
      }
    }

    return assignments;
  }

  /**
   * Ejecuta la estrategia seleccionada y devuelve el mapa de asignaciones weekKey -> memberId
   */
  function runStrategy(strategyKey, weeksData, members) {
    if (!members || members.length === 0) return {};

    switch (strategyKey) {
      case 'economic':
        return assignEconomicBalanced(weeksData, members);
      case 'holidays':
        return assignHolidaysBalanced(weeksData, members);
      case 'mixed':
        return assignMixedBalanced(weeksData, members);
      case 'round_robin':
      default:
        return assignRoundRobin(weeksData, members);
    }
  }

  /**
   * Calcula las métricas completas por persona y las estadísticas globales de dispersión
   */
  function calculateTeamMetrics(weeksData, assignments, members, options = {}) {
    if (!members || members.length === 0) {
      return {
        memberStats: [],
        totals: { weeks: 0, cost: 0, festivosPuros: 0, festivosEquiv: 0 },
        averages: { weeks: 0, cost: 0, festivosPuros: 0, festivosEquiv: 0 },
        dispersion: {
          costRange: 0,
          costStdDev: 0,
          holidaysRange: 0,
          holidaysStdDev: 0
        }
      };
    }

    const membersMap = new Map();
    members.forEach((m, idx) => {
      const palette = MEMBER_PALETTE[m.colorIndex % MEMBER_PALETTE.length] || MEMBER_PALETTE[0];
      membersMap.set(m.id, {
        id: m.id,
        name: m.name || `Persona ${idx + 1}`,
        colorIndex: m.colorIndex,
        palette,
        weeksCount: 0,
        assignedWeeks: [],
        totalCost: 0,
        festivosPuros: 0,
        cierres: 0,
        festivosEquiv: 0,
        diffCostVsMean: 0,
        diffCostPctVsMean: 0,
        diffHolidaysVsMean: 0
      });
    });

    // Sumar métricas por asignación
    weeksData.forEach(w => {
      const assignedMemberId = assignments[w.weekKey];
      if (assignedMemberId && membersMap.has(assignedMemberId)) {
        const stats = membersMap.get(assignedMemberId);
        stats.weeksCount += 1;
        stats.assignedWeeks.push(w);
        stats.totalCost = round(stats.totalCost + w.cost, 2);
        stats.festivosPuros += w.festivosPuros;
        stats.cierres += w.cierres;
        stats.festivosEquiv = round(stats.festivosEquiv + w.festivosEquivalentes, 3);
      }
    });

    const memberStatsList = Array.from(membersMap.values());
    const N = memberStatsList.length;

    // Totales
    const totalWeeks = memberStatsList.reduce((acc, m) => acc + m.weeksCount, 0);
    const totalCost = round(memberStatsList.reduce((acc, m) => acc + m.totalCost, 0), 2);
    const totalFestivosPuros = memberStatsList.reduce((acc, m) => acc + m.festivosPuros, 0);
    const totalFestivosEquiv = round(memberStatsList.reduce((acc, m) => acc + m.festivosEquiv, 0), 3);

    // Medias
    const meanWeeks = N > 0 ? round(totalWeeks / N, 2) : 0;
    const meanCost = N > 0 ? round(totalCost / N, 2) : 0;
    const meanFestivosPuros = N > 0 ? round(totalFestivosPuros / N, 2) : 0;
    const meanFestivosEquiv = N > 0 ? round(totalFestivosEquiv / N, 2) : 0;

    // Dispersión individual vs medias del equipo
    memberStatsList.forEach(m => {
      m.diffCostVsMean = round(m.totalCost - meanCost, 2);
      m.diffCostPctVsMean = meanCost > 0 ? round((m.diffCostVsMean / meanCost) * 100, 1) : 0;
      m.diffHolidaysVsMean = round(m.festivosEquiv - meanFestivosEquiv, 2);
    });

    // Dispersión global
    const costValues = memberStatsList.map(m => m.totalCost);
    const holidayValues = memberStatsList.map(m => m.festivosEquiv);

    const minCost = Math.min(...costValues);
    const maxCost = Math.max(...costValues);
    const costRange = round(maxCost - minCost, 2);

    const costVariance = costValues.reduce((acc, v) => acc + Math.pow(v - meanCost, 2), 0) / (N || 1);
    const costStdDev = round(Math.sqrt(costVariance), 2);

    const minHolidays = Math.min(...holidayValues);
    const maxHolidays = Math.max(...holidayValues);
    const holidaysRange = round(maxHolidays - minHolidays, 2);

    const holidayVariance = holidayValues.reduce((acc, v) => acc + Math.pow(v - meanFestivosEquiv, 2), 0) / (N || 1);
    const holidaysStdDev = round(Math.sqrt(holidayVariance), 2);

    return {
      memberStats: memberStatsList,
      totals: {
        weeks: totalWeeks,
        cost: totalCost,
        festivosPuros: totalFestivosPuros,
        festivosEquiv: totalFestivosEquiv
      },
      averages: {
        weeks: meanWeeks,
        cost: meanCost,
        festivosPuros: meanFestivosPuros,
        festivosEquiv: meanFestivosEquiv
      },
      dispersion: {
        costRange,
        costStdDev,
        holidaysRange,
        holidaysStdDev,
        minCost,
        maxCost,
        minHolidays,
        maxHolidays
      }
    };
  }

  const AssignmentEngine = {
    MEMBER_PALETTE,
    DEFAULT_MEMBERS,
    generateMemberId,
    round,
    calculateEquivalentHolidays,
    prepareWeeksData,
    assignRoundRobin,
    assignEconomicBalanced,
    assignHolidaysBalanced,
    assignMixedBalanced,
    runStrategy,
    calculateTeamMetrics
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AssignmentEngine;
  } else {
    global.AssignmentEngine = AssignmentEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
