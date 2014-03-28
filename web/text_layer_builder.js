/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* globals CustomStyle, PDFFindController, scrollIntoView */

'use strict';

var FIND_SCROLL_OFFSET_TOP = -50;
var FIND_SCROLL_OFFSET_LEFT = -400;

/**
 * TextLayerBuilder provides text-selection
 * functionality for the PDF. It does this
 * by creating overlay divs over the PDF
 * text. This divs contain text that matches
 * the PDF text they are overlaying. This
 * object also provides for a way to highlight
 * text that is being searched for.
 */
var TextLayerBuilder = function textLayerBuilder(options) {
  var textLayerFrag = document.createDocumentFragment();

  this.textLayerDiv = options.textLayerDiv;
  this.layoutDone = false;
  this.divContentDone = false;
  this.pageIdx = options.pageIndex;
  this.matches = [];
  this.lastScrollSource = options.lastScrollSource;
  this.viewport = options.viewport;
  this.isViewerInPresentationMode = options.isViewerInPresentationMode;
  this.currentDiv = null;
  this.currentX = 0;
  this.currentXStart = 0;
  this.currentXEnd = 0;
  this.currentY = 0;
  this.currentYStart = 0;
  this.currentFontHeight = 0;
  this.currentFontName = "";
  this.currentFontFamily = "";
  this.currentLineHeight = 0;
  this.currentRowCount = 0;
  this.currentLastElement = null;
  this.isBlockBuilding = false;

  if (typeof PDFFindController === 'undefined') {
    window.PDFFindController = null;
  }

  if (typeof this.lastScrollSource === 'undefined') {
    this.lastScrollSource = null;
  }

  this.beginLayout = function textLayerBuilderBeginLayout() {
    this.textDivs = [];
    this.renderingDone = false;
  };

  this.endLayout = function textLayerBuilderEndLayout() {
    this.layoutDone = true;
    this.insertDivContent();
  };

  this.renderLayer = function textLayerBuilderRenderLayer() {
    this.setVerticalScale();
    var textDivs = this.textDivs;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var textDiv = null;
    var font = "";

    // No point in rendering so many divs as it'd make the browser unusable
    // even after the divs are rendered
    var MAX_TEXT_DIVS_TO_RENDER = 100000;
    if (textDivs.length > MAX_TEXT_DIVS_TO_RENDER) {
      return;
    }

    for (var i = 0, ii = textDivs.length; i < ii; i++) {
      var textEle = textDivs[i];
      if ('isWhitespace' in textEle.dataset) {
        continue;
      }

      var isDiv = /div/i.test(textEle.nodeName);
      var textContent = textEle.textContent;
      if (isDiv) {
        ctx.font = textEle.style.fontSize + ' ' + textEle.style.fontFamily;
      } else {
        if (textDiv != textEle.parentNode) {
          textDiv = textEle.parentNode;
          font = textDiv.style.fontSize + ' ' + textDiv.style.fontFamily;
          ctx.font = font;
        }

        if (textEle.style.fontSize) {
          ctx.font = textEle.style.fontSize + ' ' + textEle.style.fontFamily;
        }
      }

      var width = ctx.measureText(textContent).width;
      if (!isDiv && textEle.style.fontSize) {
        ctx.font = font;
      }

      if (width > 0) {
        if (isDiv) {
          textLayerFrag.appendChild(textEle);
        } else if (textEle.parentNode.parentNode != textLayerFrag) {
          textLayerFrag.appendChild(textEle.parentNode);
        }

        var rotation = textEle.dataset.angle;
        var length = textContent.length;
        if (length == 1) {
          textEle.style.width = textEle.dataset.canvasWidth + 'px';
        } else if (rotation === '0' || !isDiv) {
          var delta = textEle.dataset.canvasWidth - width;
          var letterSpacing = delta / length + 'px';
          textEle.style.letterSpacing = letterSpacing;
        } else {
          var textScale = textEle.dataset.canvasWidth / width;
          var transform = 'rotate(' + rotation + 'deg) ' +
            'scale(' + textScale + ', 1)';
          CustomStyle.setProp('transform' , textEle, transform);
          CustomStyle.setProp('transformOrigin' , textEle, '0% 0%');
        }
      }
    }

    this.textLayerDiv.appendChild(textLayerFrag);
    this.renderingDone = true;
    this.updateMatches();
  };

  this.setupRenderLayoutTimer = function textLayerSetupRenderLayoutTimer() {
    // Schedule renderLayout() if user has been scrolling, otherwise
    // run it right away
    var RENDER_DELAY = 200; // in ms
    var self = this;
    var lastScroll = (this.lastScrollSource === null ?
                      0 : this.lastScrollSource.lastScroll);

    if (Date.now() - lastScroll > RENDER_DELAY) {
      // Render right away
      this.renderLayer();
    } else {
      // Schedule
      if (this.renderTimer) {
        clearTimeout(this.renderTimer);
      }
      this.renderTimer = setTimeout(function() {
        self.setupRenderLayoutTimer();
      }, RENDER_DELAY);
    }
  };

  this.setBlockContainer = function textLayerBuilderSetBlockContainer() {
    var textDiv = this.textDivs.pop();
    var textSpan = document.createElement('span');
    textSpan.dataset.canvasWidth = textDiv.dataset.canvasWidth;
    this.currentDiv.appendChild(textSpan);
    this.textDivs.push(textSpan);
    this.currentXStart = this.currentX;
    this.isBlockBuilding = true;
  };

  this.setVerticalScale = function textLayerBuilderSetVerticalScale() {
    if (this.currentRowCount && this.currentDiv) {
      var deltaY = this.currentY - this.currentYStart;
      var setLineHeight = deltaY / this.currentRowCount | 0;
      this.currentDiv.style.lineHeight = setLineHeight + 'px';
      var vLineScale = deltaY / (this.currentRowCount * setLineHeight);
      var transform = 'scale(1, ' + vLineScale + ')';
      CustomStyle.setProp('transform' , this.currentDiv, transform);
      CustomStyle.setProp('transformOrigin' , this.currentDiv, '0% 0%');
      this.currentRowCount = 0;
      var delta = this.currentFontHeight - this.currentLineHeight;
      if (delta) {
        this.currentDiv.style.marginTop = Math.round(delta / 2) + 'px';
      }
    }
  };

  this.createTextElement =
    function textLayerBuilderCreateTextElement (name, geom, fontHeight,
                                                isBlockLevel) {
    var ele = document.createElement(name);
    ele.dataset.canvasWidth = geom.canvasWidth * Math.abs(geom.hScale);
    if (isBlockLevel) {
      ele.dataset.fontName = geom.fontName;
      ele.dataset.angle = geom.angle * (180 / Math.PI);
      ele.style.fontSize = fontHeight + 'px';
      ele.style.fontFamily = geom.fontFamily;
    }
    return ele;
  }

  this.appendText = function textLayerBuilderAppendText(geom) {
    var x = geom.x;
    var y = geom.y;
    var fontName = geom.fontName;
    var abs = Math.abs;
    // vScale and hScale already contain the scaling to pixel units
    var fontHeight = geom.fontSize * abs(geom.vScale) | 0;
    var deltaX = abs(geom.x - this.currentX);
    var deltaY = abs(geom.y - this.currentY);
    var isSameLine = !PDFJS.disableMultilineTextLayer && geom.angle === 0 &&
      (fontHeight == this.currentFontHeight || this.isBlockBuilding) &&
      abs(geom.x - this.currentXEnd) < this.currentFontHeight &&
      abs(geom.y -this.currentY) < this.currentFontHeight / 2;
    var isNewLine = !PDFJS.disableMultilineTextLayer && geom.angle === 0 &&
      fontHeight == this.currentFontHeight &&
      (deltaX < 8 * fontHeight) &&
      ((this.currentLineHeight && (geom.y > this.currentY) &&
        abs(deltaY - this.currentLineHeight) < this.currentLineHeight / 100) ||
      (!this.currentLineHeight && (deltaY > fontHeight / 2) &&
      (this.isBlockBuilding || fontName == this.currentFontName) &&
      (deltaY < 1.5 * fontHeight)));
    var hasDifferentFont = fontHeight != this.currentFontHeight ||
      geom.fontFamily != this.currentFontFamily;

    if (isSameLine) {
      if (!this.isBlockBuilding) {
        this.setBlockContainer();
      }

      var textSpan = this.createTextElement('span', geom, fontHeight,
                                            hasDifferentFont);
      var shiftX = geom.x - this.currentXEnd;
      if (shiftX) {
        if (shiftX > fontHeight / 5) {
          // Add whitespace.
          var span = document.createElement('span');
          span.appendChild(document.createTextNode(' '));
          span.classList.add('inline-block');
          span.style.width = shiftX + 'px';
          this.currentDiv.appendChild(span);
        } else {
          textSpan.style.marginLeft = shiftX + 'px';
        }
      }

      if (/span/i.test(this.currentLastElement.nodeName)) {
        this.currentLastElement.classList.add('inline-block');
      }

      textSpan.classList.add('inline-block');
      this.currentDiv.appendChild(textSpan);
      this.textDivs.push(textSpan);
      this.currentXEnd = geom.x + geom.canvasWidth * abs(geom.hScale);
      if (fontHeight == this.currentFontHeight) {
        this.currentY = geom.y;
      }

      this.currentLastElement = textSpan;
    } else if (isNewLine) {
      if (!this.isBlockBuilding) {
        this.setBlockContainer();
      }

      if (!this.currentLineHeight) {
        this.currentLineHeight = deltaY;
      }
      this.currentRowCount++;
      this.currentDiv.appendChild(document.createTextNode('\n'));
      var textSpan = this.createTextElement('span', geom, fontHeight,
                                            hasDifferentFont);
      var shiftX = geom.x - this.currentX;
      if (shiftX) {
        textSpan.style.marginLeft = shiftX + 'px';
      }

      this.currentDiv.appendChild(textSpan);
      this.textDivs.push(textSpan);
      this.currentY = geom.y;
      this.currentXEnd = geom.x + geom.canvasWidth * abs(geom.hScale);
      this.currentLastElement = textSpan;

    } else {
      this.setVerticalScale();
      this.currentX = geom.x;
      this.currentY = geom.y;
      this.currentYStart = geom.y;
      this.currentFontHeight = fontHeight;
      this.currentFontName = fontName;
      this.currentFontFamily = geom.fontFamily;
      this.isBlockBuilding = false;
      this.currentXStart = 0;
      this.currentLineHeight = 0;
      this.currentXEnd = geom.x + geom.canvasWidth * abs(geom.hScale);
      var textDiv = this.createTextElement('div', geom, fontHeight, true);
      var fontAscent = (geom.ascent ? geom.ascent * fontHeight :
        (geom.descent ? (1 + geom.descent) * fontHeight : fontHeight));
      textDiv.style.left = (geom.x + (fontAscent * Math.sin(geom.angle))) + 'px';
      textDiv.style.top = (geom.y - (fontAscent * Math.cos(geom.angle))) + 'px';
      // The content of the div is set in the `setTextContent` function.
      this.textDivs.push(textDiv);
      this.currentDiv = textDiv;
      this.currentLastElement = textDiv;
    }
  };

  this.insertDivContent = function textLayerUpdateTextContent() {
    // Only set the content of the divs once layout has finished, the content
    // for the divs is available and content is not yet set on the divs.
    if (!this.layoutDone || this.divContentDone || !this.textContent) {
      return;
    }

    this.divContentDone = true;

    var textDivs = this.textDivs;
    var bidiTexts = this.textContent;

    for (var i = 0; i < bidiTexts.length; i++) {
      var bidiText = bidiTexts[i];
      var textDiv = textDivs[i];
      if (!/\S/.test(bidiText.str)) {
        textDiv.dataset.isWhitespace = true;
        continue;
      }

      textDiv.textContent = bidiText.str;
      // TODO refactor text layer to use text content position
      /**
       * var arr = this.viewport.convertToViewportPoint(bidiText.x, bidiText.y);
       * textDiv.style.left = arr[0] + 'px';
       * textDiv.style.top = arr[1] + 'px';
       */
      // bidiText.dir may be 'ttb' for vertical texts.
      textDiv.dir = bidiText.dir;
    }

    this.setupRenderLayoutTimer();
  };

  this.setTextContent = function textLayerBuilderSetTextContent(textContent) {
    this.textContent = textContent;
    this.insertDivContent();
  };

  this.convertMatches = function textLayerBuilderConvertMatches(matches) {
    var i = 0;
    var iIndex = 0;
    var bidiTexts = this.textContent;
    var end = bidiTexts.length - 1;
    var queryLen = (PDFFindController === null ?
                    0 : PDFFindController.state.query.length);

    var lastDivIdx = -1;
    var pos;

    var ret = [];

    // Loop over all the matches.
    for (var m = 0; m < matches.length; m++) {
      var matchIdx = matches[m];
      // # Calculate the begin position.

      // Loop over the divIdxs.
      while (i !== end && matchIdx >= (iIndex + bidiTexts[i].str.length)) {
        iIndex += bidiTexts[i].str.length;
        i++;
      }

      // TODO: Do proper handling here if something goes wrong.
      if (i == bidiTexts.length) {
        console.error('Could not find matching mapping');
      }

      var match = {
        begin: {
          divIdx: i,
          offset: matchIdx - iIndex
        }
      };

      // # Calculate the end position.
      matchIdx += queryLen;

      // Somewhat same array as above, but use a > instead of >= to get the end
      // position right.
      while (i !== end && matchIdx > (iIndex + bidiTexts[i].str.length)) {
        iIndex += bidiTexts[i].str.length;
        i++;
      }

      match.end = {
        divIdx: i,
        offset: matchIdx - iIndex
      };
      ret.push(match);
    }

    return ret;
  };

  this.renderMatches = function textLayerBuilder_renderMatches(matches) {
    // Early exit if there is nothing to render.
    if (matches.length === 0) {
      return;
    }

    var bidiTexts = this.textContent;
    var textDivs = this.textDivs;
    var prevEnd = null;
    var isSelectedPage = (PDFFindController === null ?
      false : (this.pageIdx === PDFFindController.selected.pageIdx));

    var selectedMatchIdx = (PDFFindController === null ?
                            -1 : PDFFindController.selected.matchIdx);

    var highlightAll = (PDFFindController === null ?
                        false : PDFFindController.state.highlightAll);

    var infty = {
      divIdx: -1,
      offset: undefined
    };

    function beginText(begin, className) {
      var divIdx = begin.divIdx;
      var div = textDivs[divIdx];
      div.textContent = '';

      var content = bidiTexts[divIdx].str.substring(0, begin.offset);
      var node = document.createTextNode(content);
      if (className) {
        var isSelected = isSelectedPage &&
                          divIdx === selectedMatchIdx;
        var span = document.createElement('span');
        span.className = className + (isSelected ? ' selected' : '');
        span.appendChild(node);
        div.appendChild(span);
        return;
      }
      div.appendChild(node);
    }

    function appendText(from, to, className) {
      var divIdx = from.divIdx;
      var div = textDivs[divIdx];

      var content = bidiTexts[divIdx].str.substring(from.offset, to.offset);
      var node = document.createTextNode(content);
      if (className) {
        var span = document.createElement('span');
        span.className = className;
        span.appendChild(node);
        div.appendChild(span);
        return;
      }
      div.appendChild(node);
    }

    function highlightDiv(divIdx, className) {
      textDivs[divIdx].className = className;
    }

    var i0 = selectedMatchIdx, i1 = i0 + 1, i;

    if (highlightAll) {
      i0 = 0;
      i1 = matches.length;
    } else if (!isSelectedPage) {
      // Not highlighting all and this isn't the selected page, so do nothing.
      return;
    }

    for (i = i0; i < i1; i++) {
      var match = matches[i];
      var begin = match.begin;
      var end = match.end;

      var isSelected = isSelectedPage && i === selectedMatchIdx;
      var highlightSuffix = (isSelected ? ' selected' : '');
      if (isSelected && !this.isViewerInPresentationMode) {
        scrollIntoView(textDivs[begin.divIdx], { top: FIND_SCROLL_OFFSET_TOP,
                                               left: FIND_SCROLL_OFFSET_LEFT });
      }

      // Match inside new div.
      if (!prevEnd || begin.divIdx !== prevEnd.divIdx) {
        // If there was a previous div, then add the text at the end
        if (prevEnd !== null) {
          appendText(prevEnd, infty);
        }
        // clears the divs and set the content until the begin point.
        beginText(begin);
      } else {
        appendText(prevEnd, begin);
      }

      if (begin.divIdx === end.divIdx) {
        appendText(begin, end, 'highlight' + highlightSuffix);
      } else {
        appendText(begin, infty, 'highlight begin' + highlightSuffix);
        for (var n = begin.divIdx + 1; n < end.divIdx; n++) {
          highlightDiv(n, 'highlight middle' + highlightSuffix);
        }
        beginText(end, 'highlight end' + highlightSuffix);
      }
      prevEnd = end;
    }

    if (prevEnd) {
      appendText(prevEnd, infty);
    }
  };

  this.updateMatches = function textLayerUpdateMatches() {
    // Only show matches, once all rendering is done.
    if (!this.renderingDone) {
      return;
    }

    // Clear out all matches.
    var matches = this.matches;
    var textDivs = this.textDivs;
    var bidiTexts = this.textContent;
    var clearedUntilDivIdx = -1;

    // Clear out all current matches.
    for (var i = 0; i < matches.length; i++) {
      var match = matches[i];
      var begin = Math.max(clearedUntilDivIdx, match.begin.divIdx);
      for (var n = begin; n <= match.end.divIdx; n++) {
        var div = textDivs[n];
        div.textContent = bidiTexts[n].str;
        div.className = '';
      }
      clearedUntilDivIdx = match.end.divIdx + 1;
    }

    if (PDFFindController === null || !PDFFindController.active) {
      return;
    }

    // Convert the matches on the page controller into the match format used
    // for the textLayer.
    this.matches = matches = (this.convertMatches(PDFFindController === null ?
      [] : (PDFFindController.pageMatches[this.pageIdx] || [])));

    this.renderMatches(this.matches);
  };
};

