(module
  ;; Dos imágenes RGBA de 1280 x 720 necesitan 7 372 800 bytes.
  ;; 113 páginas de WebAssembly proporcionan 7 405 568 bytes.
  (memory (export "memory") 113)


  (func (export "dilate")
    (param $input i32)
    (param $output i32)
    (param $width i32)
    (param $height i32)
    (local $x i32)
    (local $y i32)
    (local $offset i32)
    (local $source_address i32)
    (local $black i32)

    (local.set $y (i32.const 0))
    (block $rows_done
      (loop $rows
        (br_if $rows_done (i32.ge_u (local.get $y) (local.get $height)))
        (local.set $x (i32.const 0))

        (block $columns_done
          (loop $columns
            (br_if $columns_done (i32.ge_u (local.get $x) (local.get $width)))

            (local.set $offset
              (i32.shl
                (i32.add
                  (i32.mul (local.get $y) (local.get $width))
                  (local.get $x))
                (i32.const 2)))
            (local.set $source_address
              (i32.add (local.get $input) (local.get $offset)))
            (local.set $black
              (i32.eqz (i32.load8_u (local.get $source_address))))

            ;; Izquierda
            (if
              (i32.and
                (i32.eqz (local.get $black))
                (i32.gt_u (local.get $x) (i32.const 0)))
              (then
                (local.set $black
                  (i32.eqz
                    (i32.load8_u
                      (i32.sub (local.get $source_address) (i32.const 4)))))))

            ;; Derecha
            (if
              (i32.and
                (i32.eqz (local.get $black))
                (i32.lt_u
                  (i32.add (local.get $x) (i32.const 1))
                  (local.get $width)))
              (then
                (local.set $black
                  (i32.eqz
                    (i32.load8_u
                      (i32.add (local.get $source_address) (i32.const 4)))))))

            ;; Arriba
            (if
              (i32.and
                (i32.eqz (local.get $black))
                (i32.gt_u (local.get $y) (i32.const 0)))
              (then
                (local.set $black
                  (i32.eqz
                    (i32.load8_u
                      (i32.sub
                        (local.get $source_address)
                        (i32.shl (local.get $width) (i32.const 2))))))))

            ;; Abajo
            (if
              (i32.and
                (i32.eqz (local.get $black))
                (i32.lt_u
                  (i32.add (local.get $y) (i32.const 1))
                  (local.get $height)))
              (then
                (local.set $black
                  (i32.eqz
                    (i32.load8_u
                      (i32.add
                        (local.get $source_address)
                        (i32.shl (local.get $width) (i32.const 2))))))))

            (if (local.get $black)
              (then
                (i32.store
                  (i32.add (local.get $output) (local.get $offset))
                  (i32.const 0xff000000)))
              (else
                (i32.store
                  (i32.add (local.get $output) (local.get $offset))
                  (i32.load (local.get $source_address)))))

            (local.set $x (i32.add (local.get $x) (i32.const 1)))
            (br $columns)))

        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br $rows))))
)
