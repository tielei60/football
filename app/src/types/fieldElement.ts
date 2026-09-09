/* eslint-disable lines-between-class-members */
import { ELEMENT_RADIUS_OBJECT } from "@/constants";
import type { IBaseElementProps } from "./base";
import { BaseElement } from "./base";

export type ElementType = "player" | "ball"; // 球员 player  球 ball

// 球场元素
interface IFieldElementProps extends IBaseElementProps {
  r: number;
  text: string;
  elementType: ElementType;
  number?: number;
  playerPosition?: string; // 球员场上位置
  team?: string; // 主客队：home（柏林花园）/ away（对手），默认 home
  rosterId?: string | null; // 关联名单队员 id（头像/改名稳定关联），对手与临时棋子为空
}

export class FieldElement extends BaseElement implements IFieldElementProps {
  r: number;
  text: string;
  elementType: ElementType;
  number?: number;
  playerPosition?: string;
  team?: string;
  rosterId?: string | null;

  constructor(props: Partial<IFieldElementProps> = {}) {
    super(props);
    this.r = props.r || ELEMENT_RADIUS_OBJECT[props.elementType || "player"];
    this.text = props.text || "";
    this.elementType = props.elementType || "player";
    this.number = props.number;
    this.playerPosition = props.playerPosition;
    this.team = props.team || "home";
    this.rosterId = props.rosterId ?? null;
  }

  clone() {
    return new FieldElement({
      x: this.x,
      y: this.y,
      color: this.color,
      isDragging: this.isDragging,
      creationMode: this.creationMode,
      type: this.type,
      state: this.state,
      r: this.r,
      text: this.text,
      elementType: this.elementType,
      number: this.number,
      playerPosition: this.playerPosition,
      team: this.team,
      rosterId: this.rosterId,
    });
  }

  cloneIncludingId() {
    return new FieldElement({
      id: this.id,
      x: this.x,
      y: this.y,
      color: this.color,
      isDragging: this.isDragging,
      creationMode: this.creationMode,
      type: this.type,
      state: this.state,
      r: this.r,
      text: this.text,
      elementType: this.elementType,
      number: this.number,
      playerPosition: this.playerPosition,
      team: this.team,
      rosterId: this.rosterId,
    });
  }
}

export class FieldElementCollection {
  private items: FieldElement[] = [];

  add(element: FieldElement): void {
    this.items.push(element);
  }

  move(x: number, y: number, identifier?: number | string) {
    const element = this.items.find((p) => p.id === identifier);
    if (element) {
      element.move(x, y);
    }
  }

  deleteById(id: number | string): void {
    this.items = this.items.filter((element) => element.id !== id);
  }

  clear(): void {
    this.items = [];
  }

  getItems(): FieldElement[] {
    return this.items;
  }

  findById(id: number | string): FieldElement | undefined {
    return this.items.find((element) => element.id === id);
  }

  findByCreationMode(creationMode: string) {
    return this.items.filter((element) => element.creationMode === creationMode);
  }

  getAll(): FieldElement[] {
    return [...this.items];
  }
}
