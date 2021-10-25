// let utils = require("./utils")
// let timing = require("./timing");
import * as utils from "./utils";
import * as timing from "./timing";
export class Game {
    id: number;
    entities: any[];
    words: any;
    intentsReady: boolean;
    signalsReady: boolean;
    queue: any[];
    receivers: any[];
    time: number;
    focus: any;
    player: any;
    playRandomly: boolean;
    actions: any;

    constructor() {
        this.id = 0;
        this.entities = [];
        this.words = {};
        this.intentsReady = true;
        this.signalsReady = true;
        this.queue = []; // [Action*]
        this.receivers = []; // {on_signalType:func()}
        this.time = 0;
        this.player = null;
        this.playRandomly = false;
        this.actions = {};
    }

    addEntity(entity: any, parentEntity = undefined): number {
        this.entities.push(entity);
        entity.id = this.id++;
        if (parentEntity !== undefined) {
            this.setParent(parentEntity, entity);
        }
        return entity.id;
    }

    getById(id: number) {
        let found = undefined;
        for (let i = 0; i < this.entities.length; i++) {
            if (this.entities[i].id === id) {
                found = this.entities[i];
            }
        }
        if (found === undefined) throw `object not found with id ${id}`;
        return found;
    }

    getDepth(entity: { id: any }) {
        if (entity.id === undefined) throw `no id for object ${entity}`;
        let depth = 0;
        while (this.getParent(entity) !== undefined) {
            entity = this.getParent(entity);
            depth += 1;
        }
        return depth;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // PARENT
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    buildObject(entity, relations: [string, any][] = []) {
        this.addEntity(entity);
        for (let relation of relations) {
            let relationType = relation[0];
            let child = relation[1];
            this.addEntity(child);
            this.addLink(entity, child, relationType);
        }
        return entity;
    }

    addLink(fromEntity: { id: any }, toEntity: { id: any }, relation: string) {
        // check no existing link
        for (let link of this.entities.filter((l) => l.link)) {
            if (
                link.from === fromEntity.id &&
                link.to === toEntity.id &&
                link.link === relation
            )
                throw `Existing link ${link.from} ${link.to} ${relation}`;
        }
        // create link
        let link = {
            link: relation,
            from: fromEntity.id,
            to: toEntity.id,
        };
        this.addEntity(link);
        return link;
    }

    findLink(fromEntity, toEntity, relation) {
        let found = undefined;
        for (let link of this.entities.filter((l) => l.link)) {
            if (
                link.link === relation &&
                link.from === fromEntity.id &&
                link.to === toEntity.id
            ) {
                found = link;
            }
        }
        return found;
    }

    removeLink(fromEntity, toEntity, relation) {
        let found = false;
        for (let link of this.entities.filter((l) => l.link)) {
            if (
                link.link === relation &&
                link.from === fromEntity.id &&
                link.to === toEntity.id
            ) {
                found = true;
                this.deleteById(link.id);
            }
        }
        if (!found) throw `No link found ${{ fromEntity, toEntity, relation }}`;
    }

    setParent(parentEntity, childEntity) {
        if (
            parentEntity === undefined ||
            parentEntity.id === undefined ||
            this.getById(parentEntity.id) === undefined
        )
            throw "Undefined parent.";
        this.unsetParent(childEntity);
        this.addLink(parentEntity, childEntity, "parent");
    }

    setParentById(parentId, childId, relation = null) {
        this.setParent(this.getById(parentId), this.getById(childId));
    }

    unsetParent(childEntity) {
        this.unlink(childEntity, "parent");
    }

    unlink(entity, relation = null) {
        // delete links with given relation
        for (let link of this.entities.filter((l) => l.link)) {
            if (link.to === entity.id) {
                if (!relation || link.link === relation)
                    this.deleteById(link.id);
            }
        }
    }

    isParent(parentEntity, childEntity) {
        return this.findLink(parentEntity, childEntity, "parent");
    }

    getParent(childEntity) {
        let parent = undefined;
        for (let link of this.entities.filter((l) => l.link)) {
            if (link.link === "parent" && link.to === childEntity.id) {
                parent = this.getById(link.from);
            }
        }
        return parent;
    }

    getComponents(entity: { id: any }, tag: string = null): any[] {
        let components = [];
        for (let link of this.entities.filter(
            (l) => l.link && l.link === "comp" && l.from === entity.id
        )) {
            let component = this.getById(link.to);
            if (tag === null || component[tag] !== undefined) {
                components.push(component);
            }
        }
        return components.length === 0 ? null : components;
    }

    getChildrenById(id: number) {
        return this.getChildren(this.getById(id));
    }

    getChildren(entity) {
        let contents = this.entities.filter((e) => this.isParent(entity, e));
        return contents;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    deleteById(id) {
        // TODO? throw if not found
        this.entities = this.entities.filter((e) => e.id !== id);
    }

    isAccessible(entity) {
        if (entity === undefined || this.getParent(entity) === undefined)
            return true;
        let parent = this.getParent(entity);
        let accessible = !parent.closed && !parent.locked;
        return accessible && this.isAccessible(parent);
    }

    enqueue(action, i = -1) {
        if (i === -1) {
            this.queue.push(action);
        } else {
            this.queue.splice(i, 0, action);
        }
    }

    emitSignal(data) {
        for (let receiver of this.receivers) {
            if (receiver[`on_${data.type}`]) {
                receiver[`on_${data.type}`](data);
            }
        }
    }

    getIntents() {
        // get this tick's Actions {aedpcs} for every entity with intent (null or Intent)
        this.queue = [];
        this.intentsReady = true;
        for (let entity of this.entities.filter((e) => e.sequence)) {
            let sequence = entity.sequence;
            // console.log({ sequence })
            // empty intent
            if (!sequence || (sequence && sequence.length === 0)) {
                this.intentsReady = false;
                // hang and reset for player input
                if (entity.player) {
                    if (!entity.picking) {
                        entity.picking = true;
                        entity.setOptionsUI();
                    }
                    setTimeout(() => {
                        let options = entity.getNextWords();
                        if (this.playRandomly) {
                            if (entity.command.length > 0) {
                                entity.pickNextWord(
                                    Math.floor(
                                        Math.random() * (options.length - 1)
                                    )
                                );
                            } else {
                                entity.pickNextWord(
                                    Math.floor(Math.random() * options.length)
                                );
                            }
                        }
                        this.getIntents();
                    }, 1);
                }
            } else if (sequence.length > 0) {
                // extract actions and enqueue them
                let ticks = 0;
                let i = 0;

                // extract actions until we go over 1 tick
                while (ticks === 0 && i < sequence.length) {
                    let action = sequence[i];
                    this.enqueue(action);
                    // console.log(`queued up`, action);

                    // queue up actions including the first with duration
                    if (action.duration <= 0 || action.duration === undefined) {
                        // instant action, keep queueing
                        sequence.splice(i, 1);
                    } else if (action.duration > 0) {
                        // action that will be taken multiple times
                        ticks = action.duration;
                        // end actions here
                        if (action.duration <= 1) {
                            sequence.splice(i, 1);
                        }
                        // console.log(`action with ${ticks} duration`, action);
                        // TODO: make multiple intent declarations possible per tick?
                        action.duration -= 1;
                    } else {
                        // throw `Not sure what this means`;
                    }
                }
            }
        }
        // when ready, propagate signals
        if (this.intentsReady) {
            // queue up a tick signal
            this.queue.push({ signals: [{ type: "tick" }] });
            // newLine(`starting tick ${game.time}`);
            this.propagateSignals();
        }
    }

    propagateSignals() {
        // run through signal propagation and clearing, instant
        this.signalsReady = false;
        while (!this.signalsReady) {
            this.signalsReady = true;
            // for every unpropagated action with signals, propagate and clear signals
            for (let action of this.queue.filter(
                (a) => !a.propagated && a.signals && a.signals.length > 0
            )) {
                for (let signal of action.signals) {
                    // new signal to propagate
                    this.signalsReady = false;
                    let type = signal.type;
                    // send to every receiver
                    for (let receiver of this.receivers) {
                        if (receiver[`on_${type}`]) {
                            receiver[`on_${type}`](signal);
                        }
                    }
                }
                // mark as propagated
                action.propagated = true;
            }
        }
        // reset propagation for actions with duration
        for (let action of this.queue.filter((a) => a.propagated === true)) {
            action.propagated = false;
        }

        this.executeNext();
    }

    executeNext() {
        // get next action to execute
        if (this.queue.length > 0) {
            let action = this.queue.shift();
            if (action.func) {
                if (this.actions[action.func]) {
                    let func = this.actions[action.func];
                    if (action.args) {
                        func(...action.args);
                    } else {
                        func();
                    }
                } else {
                    throw `Unknown action ${action.func}, args ${action.args}`;
                }
            }
            // execute the next instantly or with pause
            if (action.pause) {
                setTimeout(() => {
                    this.executeNext();
                }, action.pause);
            } else {
                this.executeNext();
            }
        } else {
            // loop again
            this.time += 1;
            this.updateUI();
            this.getIntents();
        }
    }

    word(text) {
        if (!this.words[text]) {
            let word = { type: "word", baseName: text };
            this.words[text] = word;
        }
        return this.words[text];
    }

    updateUI() {
        this.updateEntityTreeUI();
        this.updateClockUI();
    }

    updateEntityTreeUI() {
        let ticks = this.time % timing.tps;
        let hours = Math.floor(this.time / timing.tps / 3600);
        let minutes = Math.floor(this.time / timing.tps / 60);
        let seconds = Math.floor(this.time / timing.tps);
        let game = this;
        let treeNode = document.getElementById("entityTree");
        treeNode.innerHTML = `Time: ${hours}:${minutes}:${seconds}:${ticks}\n\n</br>`;

        function indentedSubtree(entity, depth = 0) {
            if (!entity.baseName || entity.invisible) return null;
            let healthText =
                entity.health > 0 ? `[${"#".repeat(entity.health)}]` : "";

            let focusedText =
                game.player.focus === entity.id ? "(focused)" : "";
            let textNode = document.createElement("a");
            // textNode.style.color = "lightgrey";
            textNode.innerText = `|${"----".repeat(game.getDepth(entity))}${
                entity.baseName
            } ${healthText}${focusedText}\n`;
            textNode.className = "treeObject";
            if (game.getChildren(entity).length > 0) {
                for (let child of game
                    .getChildren(entity)
                    .filter((e) => game.isAccessible(e))) {
                    textNode.appendChild(indentedSubtree(child, depth + 1));
                }
            }

            // on click, focus action
            textNode.addEventListener("click", function (e) {
                e = <MouseEvent>window.event || e;
                if (this === e.target) {
                    game.player.focus = entity.id;
                    game.player.command = [];
                    game.player.setOptionsUI();
                }
                game.updateEntityTreeUI();
            });

            return textNode;
        }

        for (let entity of this.entities.filter(
            (e) => this.getDepth(e) === 0
        )) {
            let subtree = indentedSubtree(entity, 0);
            if (subtree) {
                treeNode.appendChild(subtree);
            }
        }
    }

    updateClockUI() {
        let clock = <HTMLCanvasElement>document.getElementById("clock");
        let ctx = clock.getContext("2d");
        let width = clock.clientWidth;
        let height = clock.clientHeight;
        // ctx.stroke = "white";
        ctx.clearRect(0, 0, width, height);
        ctx.fillText(`${this.time}`, width / 2 - 6, height / 2 + 5);

        // dots
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.beginPath();
        ctx.rotate(-Math.PI / 2);
        for (let i = 0; i < 12; i++) {
            ctx.moveTo(20, 0);
            ctx.lineTo(25, 0);
            ctx.rotate((2 * Math.PI) / 12);
        }
        ctx.stroke();
        ctx.restore();

        // ticks
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.beginPath();
        ctx.rotate(-Math.PI / 2);
        ctx.rotate((2 * Math.PI * this.time) / timing.tps);
        ctx.arc(10, 0, 2, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.restore();

        // seconds

        // ticks
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.beginPath();
        ctx.rotate(-Math.PI / 2);
        ctx.rotate((2 * Math.PI * this.time) / timing.tps / 60);
        ctx.moveTo(10, 0);
        ctx.lineTo(25, 0);
        ctx.stroke();
        ctx.restore();
    }
}

// let g = new Game();

// let teapot = g.buildObject(
//     {
//         teapot: true,
//     },
//     [
//         ["is", { fluidContainer: true }],
//         ["has", { spout: true }],
//     ]
// );
// console.log(g.entities);
