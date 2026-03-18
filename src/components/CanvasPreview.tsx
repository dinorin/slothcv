import React from 'react';
import { Stage, Layer, Rect, Text, Circle, Line, Image } from 'react-konva';
import useImage from 'use-image';
import { CanvasElement } from '../types';

const CanvasImage = ({ element }: { element: CanvasElement }) => {
  const [img] = useImage(element.text || '');
  return (
    <Image
      image={img}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      draggable={element.draggable}
    />
  );
};

interface CanvasPreviewProps {
  elements: CanvasElement[];
  width: number;
  height: number;
}

const CanvasPreview: React.FC<CanvasPreviewProps> = ({ elements, width, height }) => {
  // Scale factor to fit the stage into the container
  const containerWidth = 800; // Default container width
  const scale = containerWidth / 794;

  return (
    <div className="bg-neutral-200 p-8 flex justify-center overflow-auto min-h-screen">
      <div 
        className="bg-white shadow-2xl"
        style={{ width: 794 * scale, height: 1123 * scale }}
      >
        <Stage width={794} height={1123} scaleX={scale} scaleY={scale}>
          <Layer>
            {elements?.map((el) => {
              switch (el.type) {
                case 'rect':
                  return (
                    <Rect
                      key={el.id}
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                      fill={el.fill}
                      stroke={el.stroke}
                      strokeWidth={el.strokeWidth}
                      opacity={el.opacity}
                      draggable={el.draggable}
                    />
                  );
                case 'circle':
                  return (
                    <Circle
                      key={el.id}
                      x={el.x}
                      y={el.y}
                      radius={el.radius}
                      fill={el.fill}
                      stroke={el.stroke}
                      strokeWidth={el.strokeWidth}
                      draggable={el.draggable}
                    />
                  );
                case 'text':
                  return (
                    <Text
                      key={el.id}
                      x={el.x}
                      y={el.y}
                      text={el.text}
                      fontSize={el.fontSize}
                      fontFamily={el.fontFamily}
                      fill={el.fill}
                      align={el.align}
                      fontStyle={el.fontStyle}
                      width={el.width}
                      draggable={el.draggable}
                    />
                  );
                case 'line':
                  return (
                    <Line
                      key={el.id}
                      points={el.points}
                      stroke={el.stroke}
                      strokeWidth={el.strokeWidth}
                      draggable={el.draggable}
                    />
                  );
                case 'image':
                  return <CanvasImage key={el.id} element={el} />;
                default:
                  return null;
              }
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  );
};

export default CanvasPreview;
