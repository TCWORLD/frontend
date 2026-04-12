import { endOfToday, isToday, startOfToday } from "date-fns";
import type { HassConfig, UnsubscribeFunc } from "home-assistant-js-websocket";
import type { PropertyValues } from "lit";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators";
import { classMap } from "lit/directives/class-map";
import memoizeOne from "memoize-one";
import type { BarSeriesOption } from "echarts/charts";
import { getEnergyColor } from "./common/color";
import "../../../../components/chart/ha-chart-base";
import "../../../../components/ha-card";
import type {
  EnergyData,
  HeatingSourceTypeEnergyPreference,
} from "../../../../data/energy";
import {
  getEnergyDataCollection,
  getSuggestedPeriod,
  validateEnergyCollectionKey,
} from "../../../../data/energy";
import type { Statistics, StatisticsMetaData } from "../../../../data/recorder";
import { getStatisticLabel } from "../../../../data/recorder";
import type { FrontendLocaleData } from "../../../../data/translation";
import { SubscribeMixin } from "../../../../mixins/subscribe-mixin";
import type { HomeAssistant } from "../../../../types";
import type { LovelaceCard } from "../../types";
import type { EnergyHeatingGraphCardConfig } from "../types";
import { hasConfigChanged } from "../../common/has-changed";
import {
  computeStatMidpoint,
  type EnergyDataPoint,
  fillDataGapsAndRoundCaps,
  getCommonOptions,
  getCompareTransform,
} from "./common/energy-chart-options";
import type { ECOption } from "../../../../resources/echarts/echarts";
import { formatNumber } from "../../../../common/number/format_number";
import "./common/hui-energy-graph-chip";
import "../../../../components/ha-tooltip";

const HEATING_TOTAL_CONSUMED = 0;
const HEATING_TOTAL_DELIVERED = 1;

@customElement("hui-energy-heating-graph-card")
export class HuiEnergyHeatingGraphCard
  extends SubscribeMixin(LitElement)
  implements LovelaceCard
{
  public static async getConfigElement() {
    await import("../../editor/config-elements/hui-energy-graph-card-editor");
    return document.createElement("hui-energy-graph-card-editor");
  }

  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _config?: EnergyHeatingGraphCardConfig;

  public static getStubConfig(
    _hass: HomeAssistant,
    _entities: string[],
    _entitiesFill: string[]
  ): EnergyHeatingGraphCardConfig {
    return {
      type: "energy-heating-graph",
    };
  }

  @state() private _chartData: BarSeriesOption[] = [];

  @state() private _start = startOfToday();

  @state() private _end = endOfToday();

  @state() private _compareStart?: Date;

  @state() private _compareEnd?: Date;

  @state() private _unit?: string;

  @state() private _total?: number[];

  protected hassSubscribeRequiredHostProps = ["_config"];

  public hassSubscribe(): UnsubscribeFunc[] {
    return [
      getEnergyDataCollection(this.hass, {
        key: this._config?.collection_key,
      }).subscribe((data) => this._getStatistics(data)),
    ];
  }

  public getCardSize(): Promise<number> | number {
    return 3;
  }

  public setConfig(config: EnergyHeatingGraphCardConfig): void {
    if (config.collection_key) {
      validateEnergyCollectionKey(config.collection_key);
    }
    this._config = config;
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    return (
      hasConfigChanged(this, changedProps) ||
      changedProps.size > 1 ||
      !changedProps.has("hass")
    );
  }

  protected render() {
    if (!this.hass || !this._config) {
      return nothing;
    }

    let cop = 0;
    if (this._total?.length && this._total[HEATING_TOTAL_CONSUMED]) {
      cop =
        this._total[HEATING_TOTAL_DELIVERED] /
        this._total[HEATING_TOTAL_CONSUMED];
    }

    return html`
      <ha-card>
        ${this._config.title
          ? html` <div class="card-header">
              <span>${this._config.title ? this._config.title : nothing}</span>
              ${cop
                ? html`<hui-energy-graph-chip .tooltip=${this._formatCop(cop)}>
                    ${formatNumber(cop)}
                  </hui-energy-graph-chip>`
                : nothing}
            </div>`
          : nothing}
        <div
          class="content ${classMap({
            "has-header": !!this._config.title,
          })}"
        >
          <ha-chart-base
            .hass=${this.hass}
            .data=${this._chartData}
            .options=${this._createOptions(
              this._start,
              this._end,
              this.hass.locale,
              this.hass.config,
              this._unit,
              this._compareStart,
              this._compareEnd
            )}
            chart-type="bar"
          ></ha-chart-base>
          ${!this._chartData.length
            ? html`<div class="no-data">
                ${isToday(this._start)
                  ? this.hass.localize("ui.panel.lovelace.cards.energy.no_data")
                  : this.hass.localize(
                      "ui.panel.lovelace.cards.energy.no_data_period"
                    )}
              </div>`
            : ""}
        </div>
      </ha-card>
    `;
  }

  private _formatCop = (cop: number) =>
    this.hass.localize(
      "ui.panel.lovelace.cards.energy.energy_heating_graph.overall_cop",
      { num: formatNumber(cop, this.hass.locale) }
    );

  private _formatTotal = (total: number) =>
    this.hass.localize(
      "ui.panel.lovelace.cards.energy.energy_heating_graph.total_consumed",
      { num: formatNumber(total, this.hass.locale), unit: this._unit }
    );

  private _createOptions = memoizeOne(
    (
      start: Date,
      end: Date,
      locale: FrontendLocaleData,
      config: HassConfig,
      unit?: string,
      compareStart?: Date,
      compareEnd?: Date
    ): ECOption =>
      getCommonOptions(
        start,
        end,
        locale,
        config,
        unit,
        compareStart,
        compareEnd
      )
  );

  private async _getStatistics(energyData: EnergyData): Promise<void> {
    this._start = energyData.start;
    this._end = energyData.end || endOfToday();

    this._compareStart = energyData.startCompare;
    this._compareEnd = energyData.endCompare;

    const heatingSources: HeatingSourceTypeEnergyPreference[] =
      energyData.prefs.energy_sources.filter(
        (source) => source.type === "heating"
      ) as HeatingSourceTypeEnergyPreference[];

    this._unit = "kW";

    const datasets: BarSeriesOption[] = [];

    const computedStyles = getComputedStyle(this);

    if (energyData.statsCompare) {
      datasets.push(
        ...this._processDataSet(
          energyData.statsCompare,
          energyData.statsMetadata,
          heatingSources,
          computedStyles,
          true
        )
      );
    } else {
      // add empty dataset so compare bars are first
      // `stack: heating` so it doesn't take up space yet
      const firstId =
        heatingSources[0]?.stat_energy_from ??
        heatingSources[0]?.stat_energy_to ??
        "placeholder";
      datasets.push({
        id: "compare-" + firstId,
        type: "bar",
        stack: "heating",
        data: [],
      });
    }

    datasets.push(
      ...this._processDataSet(
        energyData.stats,
        energyData.statsMetadata,
        heatingSources,
        computedStyles
      )
    );

    fillDataGapsAndRoundCaps(datasets);
    this._chartData = datasets;
    this._total = this._processTotal(energyData.stats, heatingSources);
  }

  private _processTotal(
    statistics: Statistics,
    heatingSources: HeatingSourceTypeEnergyPreference[]
  ) {
    return heatingSources.reduce(
      (sum, source) => [
        sum[HEATING_TOTAL_CONSUMED] +
          (source.stat_energy_to && source.stat_energy_to in statistics
            ? statistics[source.stat_energy_to].reduce(
                (acc, curr) => acc + (curr.change || 0),
                0
              )
            : 0),
        sum[HEATING_TOTAL_DELIVERED] +
          (source.stat_energy_from in statistics
            ? statistics[source.stat_energy_from].reduce(
                (acc, curr) => acc + (curr.change || 0),
                0
              )
            : 0),
      ],
      [0, 0]
    );
  }

  private _processSourceEntityDataSet(
    statistics: Statistics,
    statisticsMetaData: Record<string, StatisticsMetaData>,
    computedStyles: CSSStyleDeclaration,
    entity: string | null | undefined,
    idx: number,
    delivered: boolean,
    period: "5minute" | "hour" | "day" | "month",
    compare = false,
    compareTransform = (ts: Date) => ts
  ): BarSeriesOption | undefined {
    if (!entity) return undefined;
    let prevStart: number | null = null;
    const heatingData: BarSeriesOption["data"] = [];
    if (entity in statistics) {
      const stats = statistics[entity];
      for (const point of stats) {
        if (
          point.change === null ||
          point.change === undefined ||
          point.change === 0
        ) {
          continue;
        }
        if (prevStart === point.start) {
          continue;
        }
        const dataPoint: EnergyDataPoint = [
          computeStatMidpoint(
            point.start,
            point.end,
            period,
            compare ? compareTransform : undefined
          ),
          point.change,
          point.start,
        ];
        heatingData.push(dataPoint);
        prevStart = point.start;
      }
    }
    return {
      type: "bar",
      cursor: "default",
      id: compare ? "compare-" + entity : entity,
      name: getStatisticLabel(this.hass, entity, statisticsMetaData[entity]),
      barMaxWidth: 50,
      itemStyle: {
        borderColor: getEnergyColor(
          computedStyles,
          this.hass.themes.darkMode,
          false,
          compare,
          "--energy-heating-color",
          idx
        ),
      },
      color: getEnergyColor(
        computedStyles,
        this.hass.themes.darkMode,
        true,
        compare,
        "--energy-heating-color",
        idx
      ),
      data: heatingData,
      stack: (delivered ? "" : "consumed-") + (compare ? "compare" : "heating"),
    };
  }

  private _processDataSet(
    statistics: Statistics,
    statisticsMetaData: Record<string, StatisticsMetaData>,
    heatingSources: HeatingSourceTypeEnergyPreference[],
    computedStyles: CSSStyleDeclaration,
    compare = false
  ) {
    const data: BarSeriesOption[] = [];
    const compareTransform = getCompareTransform(
      this._start,
      this._compareStart!
    );
    const period = getSuggestedPeriod(this._start, this._end);

    heatingSources.forEach((source, idx) => {
      // Process heating delivered data.
      const deliveredBarData = this._processSourceEntityDataSet(
        statistics,
        statisticsMetaData,
        computedStyles,
        source.stat_energy_from,
        idx,
        true,
        period,
        compare,
        compareTransform
      );
      if (deliveredBarData) {
        data.push(deliveredBarData);
      }
      // Process heating consumption data.
      const consumptionBarData = this._processSourceEntityDataSet(
        statistics,
        statisticsMetaData,
        computedStyles,
        source.stat_energy_to,
        idx,
        false,
        period,
        compare,
        compareTransform
      );
      if (consumptionBarData) {
        data.push(consumptionBarData);
      }
    });
    return data;
  }

  static styles = css`
    ha-card {
      height: 100%;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 0;
    }
    .content {
      padding: 16px;
    }
    .has-header {
      padding-top: 0;
    }
    .no-data {
      position: absolute;
      height: 100%;
      top: 0;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20%;
      margin-left: 32px;
      margin-inline-start: 32px;
      margin-inline-end: initial;
      box-sizing: border-box;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "hui-energy-heating-graph-card": HuiEnergyHeatingGraphCard;
  }
}
