/**
 * CompensaGuardias - Motor de Cálculo de Compensaciones
 * Lógica matemática para distribución ponderada de presupuesto y control de costes.
 */

(function (global) {
  'use strict';

  /**
   * Redondeo a N decimales seguro contra errores de coma flotante
   */
  function round(val, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round((val + Number.EPSILON) * factor) / factor;
  }

  /**
   * Cálculo de la distribución ponderada del presupuesto anual
   * 
   * @param {Object} params
   * @param {number} params.presupuestoAnual - Presupuesto total del año en euros
   * @param {Object} params.dayCounts - { normal: number, cierre: number, festivo: number }
   * @param {Object} params.weights - { normal: number, cierre: number, festivo: number }
   * @param {boolean} [params.strictCeiling=false] - Garantiza que el coste redondeado no supere el presupuesto
   */
  function calculateRates(params) {
    const {
      presupuestoAnual,
      dayCounts = { normal: 327, cierre: 24, festivo: 14 },
      weights = { normal: 1.0, cierre: 1.3, festivo: 1.8 },
      strictCeiling = false
    } = params;

    const nNorm = Number(dayCounts.normal) || 0;
    const nCier = Number(dayCounts.cierre) || 0;
    const nFest = Number(dayCounts.festivo) || 0;
    const totalDays = nNorm + nCier + nFest;

    const wNorm = Math.max(0.01, Number(weights.normal) || 1.0);
    const wCier = Math.max(0.01, Number(weights.cierre) || 1.0);
    const wFest = Math.max(0.01, Number(weights.festivo) || 1.0);

    // Suma ponderada: sum(días_i * ponderación_i)
    const sumaPonderada = (nNorm * wNorm) + (nCier * wCier) + (nFest * wFest);

    // Valor base monetario de una unidad de guardia: Presupuesto anual / suma ponderada
    const valorBase = sumaPonderada > 0 ? (presupuestoAnual / sumaPonderada) : 0;

    // Precios unitarios teóricos exactos
    const precioNormalExact = valorBase * wNorm;
    const precioCierreExact = valorBase * wCier;
    const precioFestivoExact = valorBase * wFest;

    // Coste anual exacto (matemáticamente idéntico al presupuesto anual)
    const costeAnualExacto = (nNorm * precioNormalExact) + (nCier * precioCierreExact) + (nFest * precioFestivoExact);

    // Precios unitarios estándar redondeados a 2 decimales (céntimos)
    let precioNormal = round(precioNormalExact, 2);
    let precioCierre = round(precioCierreExact, 2);
    let precioFestivo = round(precioFestivoExact, 2);

    let costeAnualRedondeado = (nNorm * precioNormal) + (nCier * precioCierre) + (nFest * precioFestivo);
    let diffRedondeo = costeAnualRedondeado - presupuestoAnual;

    // Modo de restricción estricta anti-desbordamiento:
    // Si el redondeo estándar de 2 decimales provocara que el total supere el presupuesto límite
    // (típico redondeo de mitades hacia arriba de unos pocos céntimos en 365 días),
    // ajustamos los precios al céntimo inferior necesario para garantizar strictly coste <= presupuesto.
    if (strictCeiling && diffRedondeo > 0.0001) {
      if (nNorm > 0 && (nNorm * 0.01) >= diffRedondeo) {
        precioNormal = round(precioNormal - 0.01, 2);
      } else if (nFest > 0 && (nFest * 0.01) >= diffRedondeo) {
        precioFestivo = round(precioFestivo - 0.01, 2);
      } else if (nCier > 0 && (nCier * 0.01) >= diffRedondeo) {
        precioCierre = round(precioCierre - 0.01, 2);
      }
      costeAnualRedondeado = (nNorm * precioNormal) + (nCier * precioCierre) + (nFest * precioFestivo);
      diffRedondeo = costeAnualRedondeado - presupuestoAnual;
    }

    const margenRestante = round(presupuestoAnual - costeAnualRedondeado, 2);
    const cumpleRestriccion = costeAnualRedondeado <= (presupuestoAnual + 0.005);
    const porcentajeConsumido = presupuestoAnual > 0 ? round((costeAnualRedondeado / presupuestoAnual) * 100, 2) : 0;

    return {
      presupuestoAnual,
      totalDays,
      dayCounts: { normal: nNorm, cierre: nCier, festivo: nFest },
      weights: { normal: wNorm, cierre: wCier, festivo: wFest },
      sumaPonderada: round(sumaPonderada, 4),
      valorBase: round(valorBase, 4),
      preciosExactos: {
        normal: precioNormalExact,
        cierre: precioCierreExact,
        festivo: precioFestivoExact
      },
      precios: {
        normal: precioNormal,
        cierre: precioCierre,
        festivo: precioFestivo
      },
      costeAnualExacto: round(costeAnualExacto, 2),
      costeAnualRedondeado: round(costeAnualRedondeado, 2),
      diffRedondeo: round(diffRedondeo, 2),
      margenRestante,
      cumpleRestriccion,
      porcentajeConsumido,
      strictCeiling
    };
  }

  /**
   * Calcula el coste de una semana a partir de una lista de días
   * @param {Array<Object>} days - Lista de días con propiedad 'type' ('normal', 'cierre', 'festivo')
   * @param {Object} rates - { normal, cierre, festivo }
   * @param {boolean} [useExact=false]
   */
  function calculateWeekCost(days, rates, useExact = false) {
    let counts = { normal: 0, cierre: 0, festivo: 0 };
    let total = 0;
    const daysWithCost = [];

    for (const d of days) {
      const type = d.type || 'normal';
      if (counts[type] !== undefined) {
        counts[type]++;
      } else {
        counts.normal++;
      }

      const rate = rates[type] !== undefined ? rates[type] : rates.normal;
      const dayCost = useExact ? rate : round(rate, 2);
      total += dayCost;

      daysWithCost.push({
        ...d,
        rateApplied: dayCost
      });
    }

    return {
      total: round(total, 2),
      counts,
      days: daysWithCost
    };
  }

  /**
   * Genera los arquetipos estándar de semanas para comparación rápida
   */
  function getWeekArchetypes(rates) {
    const p = rates;
    return [
      {
        id: 'estandar',
        title: 'Semana Estándar',
        subtitle: '7 días estándar (laborables + fin de semana sin festivos)',
        badge: 'Estándar',
        badgeColor: 'blue',
        counts: { normal: 7, cierre: 0, festivo: 0 },
        cost: round(7 * p.normal, 2)
      },
      {
        id: 'un_festivo',
        title: 'Semana con 1 Festivo',
        subtitle: '6 días estándar + 1 festivo intersemanal',
        badge: '1 Festivo',
        badgeColor: 'purple',
        counts: { normal: 6, cierre: 0, festivo: 1 },
        cost: round((6 * p.normal) + (1 * p.festivo), 2)
      },
      {
        id: 'cierre_verano',
        title: 'Semana Cierre Verano',
        subtitle: '5 días de vacaciones obligatorias + 2 días de fin de semana',
        badge: '5 Cierres',
        badgeColor: 'amber',
        counts: { normal: 2, cierre: 5, festivo: 0 },
        cost: round((2 * p.normal) + (5 * p.cierre), 2)
      },
      {
        id: 'semana_santa',
        title: 'Semana Santa',
        subtitle: '3 días de cierre + 2 festivos (Jueves y Viernes Santo) + 2 normales',
        badge: 'Semana Santa',
        badgeColor: 'rose',
        counts: { normal: 2, cierre: 3, festivo: 2 },
        cost: round((2 * p.normal) + (3 * p.cierre) + (2 * p.festivo), 2)
      }
    ];
  }

  const Calculator = {
    round,
    calculateRates,
    calculateWeekCost,
    getWeekArchetypes
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Calculator;
  } else {
    global.Calculator = Calculator;
  }
})(typeof window !== 'undefined' ? window : globalThis);
