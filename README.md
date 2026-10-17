# CompensaGuardias ⏱️

Aplicación web estática (100% en cliente, HTML5, CSS3 y JavaScript moderno) para calcular y presupuestar las compensaciones de guardias localizadas a lo largo del año.

## Características

- **Calendario Laboral 2026**: Integración nativa del calendario (`calendario-2026.json`) distinguiendo días normales (327), cierres/vacaciones obligatorias (24) y festivos oficiales (14).
- **Presupuesto Configurable**: Presupuesto semanal base (600 € por defecto) sincronizado con el presupuesto anual.
- **Restricción Estricta**: Control presupuestario en tiempo real con garantía anti-desbordamiento ante redondeos de céntimos en nómina.
- **Ponderaciones Interactivas**: Ajuste de coeficientes mediante sliders e inputs numéricos para cada tipo de día con presets rápidos.
- **Calendario Anual Interactivo**: Vista de los 12 meses con selección de semanas (`W01` - `W53`), inspección desglosada día por día y visualización directa de la persona asignada por semana mediante etiquetas de colores.
- **Módulo de Reparto y Asignación de Guardias**:
  - **Equipo dinámico de 1 a 6 personas**: Posibilidad de añadir, editar nombres o eliminar miembros con código cromático personalizado.
  - **Equivalencia de vacaciones/cierres como festivo**: Checkbox configurable y ponderación editable (por defecto $0.5$, de modo que 2 días de cierre cuenten como 1 festivo equivalente).
  - **4 Estrategias de reparto**:
    1. *Equidad económica*: Minimiza la varianza e importe cobrado anual entre los miembros respetando la equidad de semanas.
    2. *Equidad en festivos*: Minimiza la disparidad en festivos equivalentes con control secundario de ingresos.
    3. *Equilibrio mixto*: Algoritmo multiobjetivo con balance óptimo entre ingresos y festivos.
    4. *Turno rotativo estricto (Round-Robin)*: Asignación secuencial fija para diagnóstico de desviaciones naturales.
  - **Métricas y KPIs de dispersión**: Tabla resumen anual con totales por persona, indicadores $\Delta €$ y $\Delta \text{festivos}$ respecto a la media del equipo, y tarjetas de dispersión global (rango máx-mín y desviación típica).
  - **Reasignación manual interactiva**: Cambio de responsable en cualquier semana con un solo clic y recálculo instantáneo de todas las métricas.
- **Listado y Comparador**: Tabla de semanas con filtros (estándar, con festivos, con cierres), ordenación y reasignación directa.
- **Auditoría y Conciliación**: Matriz matemática con porcentajes de reparto y balance de seguridad.
- **Exportación e Importación**: Descarga en formato CSV y JSON enriquecidos con los datos del equipo asignado, soporte para cargar otros calendarios laborales JSON e impresión amigable.

## Uso

Al ser una aplicación 100% cliente sin backend ni dependencias, basta con abrir `index.html` en cualquier navegador web moderno:

```bash
# Directamente en el navegador:
xdg-open index.html

# O sirviéndolo con un servidor HTTP local:
python3 -m http.server 8000
```
